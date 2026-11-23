// «الحضور اليومي». One hero card answers «who is in» (the headline, a stacked bar, the arrivals
// chart); below it the EMPLOYEE ATTENDANCE TABLE: a title bar (search, a Filter button that opens
// branch and section, Sort by), status segments with counts, and one row per person — photo, name
// and code, job title and department, date, FIRST check-in – FIRST check-out, duration, overtime,
// status and the «⋯». Repeated presses never appear here (the employee's scan log is where they
// live). Pressing a person opens the pop-up of their recent days. Presentational: the page owns data.
import { useState, type ReactNode } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { type ArrivalSlot } from './view-charts';
import { SheetHero } from './sheet-hero';
import { AttendanceCanvas, DayStepper, FIG, INK, INK2, INK3, PageHeader, PersonAvatar, RowMenu, Sheet, StatusPill, type Tone } from './view-parts';
import { clock, num, shortDuration, timeSpan } from './view-format';
import { useViewLabels } from './view-labels';
import { SortMenu, StatusSegments } from './toolbar';
import type { SheetFilter, SheetRow, SheetSort, SheetSortKey, SheetSummary } from './view-types';

export interface DailySheetViewProps {
  /** «الثلاثاء، 17 نوفمبر 2026», already formatted. */
  dateTitle: string;
  /** The page's own date input (kept so the page controls it). */
  dateInput: ReactNode;
  onPrevDay: () => void;
  onNextDay: () => void;
  /** The page's search box, drawn in the table's title bar. */
  search?: ReactNode;
  /** The page's branch / section controls, shown when Filter is pressed. */
  filters: ReactNode;
  /** How many branch/section values are picked — the Filter button's badge, and it opens itself. */
  filterCount?: number;
  /** The board's date, short («17 Nov 2026»), for the Date column. */
  dateShort?: string;
  summary: SheetSummary;
  /** Arrivals per 15-minute slot for the whole (filtered) day, not just this page of rows. */
  arrivals: ArrivalSlot[];
  /** Start of the working day and its grace, minutes; null when nobody on the sheet has one. */
  dayStart: number | null;
  grace: number;
  /** Minutes after midnight now, only when the date is today. */
  now: number | null;
  /** Last scan received, already formatted («منذ دقيقتين»). */
  lastScan: string | null;
  activeFilter: SheetFilter;
  onFilter: (f: SheetFilter) => void;
  rows: SheetRow[];
  loading?: boolean;
  /** «عرض 1–8 من 8» and the pager, from the page. */
  footer?: ReactNode;
  onExport?: () => void;
  /** Opens the employee's profile (attendance tab). */
  onOpenEmployee?: (id: string) => void;
  /** The order the rows arrived in, and how to ask for another — the server sorts the whole day. */
  sort?: SheetSort;
  onSort?: (by: SheetSortKey, dir: 'asc' | 'desc') => void;
}

export const DailySheetView = (p: DailySheetViewProps): JSX.Element => {
  const { t, status } = useViewLabels();
  const sortHint = (dir: 'asc' | 'desc'): string => t(dir === 'asc' ? 'sortAscending' : 'sortDescending');
  const s = p.summary;

  const tabs: { key: SheetFilter; label: string; value: number; tone: Tone }[] = [
    { key: 'all', label: t('allToday'), value: s.employees, tone: 'accent' },
    { key: 'present', label: t('present'), value: s.present, tone: 'ok' },
    { key: 'late', label: t('late'), value: s.late, tone: 'warn' },
    { key: 'notYetIn', label: t('notYetIn'), value: s.notYetIn, tone: 'muted' },
    { key: 'absent', label: t('absent'), value: s.absent, tone: 'bad' },
    { key: 'onLeave', label: t('onLeave'), value: s.onLeave, tone: 'info' },
    { key: 'noRecord', label: t('noRecord'), value: s.noRecord, tone: 'muted' },
    { key: 'noSchedule', label: t('noSchedule'), value: s.noSchedule, tone: 'muted' },
    { key: 'offDay', label: t('offDay'), value: s.offDay, tone: 'muted' },
  ];
  const [showFilters, setShowFilters] = useState((p.filterCount ?? 0) > 0);

  return (
    <AttendanceCanvas fill>
      <PageHeader
        eyebrow={t('dailyAttendance')}
        title={p.dateTitle}
        meta={
          p.lastScan !== null ? (
            <span className="inline-flex items-center gap-2">
              <span className="att-live h-2 w-2 rounded-full bg-[var(--att-ok)]" />
              {t('lastPunch')} <span className={cn('font-semibold', INK)}>{p.lastScan}</span>
            </span>
          ) : undefined
        }
        actions={
          <>
            <DayStepper input={p.dateInput} onPrev={p.onPrevDay} onNext={p.onNextDay} prevLabel={t('prevDay')} nextLabel={t('nextDay')} />
            {p.onExport !== undefined && (
              <button type="button" className="att-btn" onClick={p.onExport}>
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
                </svg>
                {t('exportCsv')}
              </button>
            )}
          </>
        }
      />

      {/* THE HERO: today at a glance — a ring, the statuses as tiles (each filters the table), and
          three facts in words; then when people arrived, in its own card. */}
      <SheetHero
        summary={s}
        tabs={tabs}
        activeFilter={p.activeFilter}
        onFilter={p.onFilter}
        arrivals={p.arrivals}
        dayStart={p.dayStart}
        grace={p.grace}
        now={p.now}
      />

      <Sheet className="flex flex-1 flex-col overflow-hidden">
        {/* TITLE BAR — the table's name, then search, Filter and Sort by. */}
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-5 sm:px-6">
          <h2 className={cn('me-auto text-[17px] font-semibold', INK)}>
            {t('employeeAttendance')}
            <bdi className={cn('ms-2 text-[13px] font-medium', FIG, INK3)}>{num(s.employees)}</bdi>
          </h2>
          {p.search !== undefined && <div className="w-full sm:w-64">{p.search}</div>}
          <button
            type="button"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors',
              showFilters || (p.filterCount ?? 0) > 0
                ? 'border-[var(--att-accent)] bg-[var(--att-accent-soft)] text-[color:var(--att-accent)]'
                : cn('border-[var(--att-line)] hover:border-[var(--att-line-strong)]', INK2),
            )}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" />
            </svg>
            {t('filter')}
            {(p.filterCount ?? 0) > 0 && (
              <bdi className={cn('rounded-full bg-[var(--att-accent)] px-1.5 text-[11px] font-semibold text-white', FIG)}>{p.filterCount}</bdi>
            )}
          </button>
          {p.onSort !== undefined && (
            <SortMenu
              options={SORTS.map(([key, labelKey]) => ({ key, label: t(labelKey) }))}
              by={p.sort?.by}
              dir={p.sort?.dir}
              onSort={p.onSort}
              sortByLabel={t('sortBy')}
              reverseLabel={t('reverseOrder')}
              hint={sortHint}
            />
          )}
        </div>

        {showFilters && <div className="att-open px-5 pb-3 sm:px-6">{p.filters}</div>}

        <div className="px-5 pb-4 sm:px-6">
          <StatusSegments segments={tabs} active={p.activeFilter} allKey="all" onPick={p.onFilter} moreLabel={t('moreStatuses')} ariaLabel={t('status')} />
        </div>

        {/* THE TABLE. `flex-1` so the spare height of a tall screen lands HERE, under the rows,
            rather than outside the card as a gap — the table keeps its natural height on a screen
            that is already full, because a flex item never shrinks below its content. */}
        <div className="flex-1 overflow-x-auto px-3 pb-2 sm:px-4">
          <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-start">
            <thead>
              <tr>
                <Th label={t('employee')} sortKey="name" sort={p.sort} onSort={p.onSort} hint={sortHint} first />
                <Th label={t('jobTitle')} />
                <Th label={t('date')} />
                <Th label={t('checkInOut')} sortKey="checkIn" sort={p.sort} onSort={p.onSort} hint={sortHint} />
                <Th label={t('duration')} sortKey="worked" sort={p.sort} onSort={p.onSort} hint={sortHint} />
                <Th label={t('overtime')} />
                <Th label={t('status')} sortKey="status" sort={p.sort} onSort={p.onSort} hint={sortHint} />
                <th className="w-12 rounded-e-xl bg-[var(--att-sheet-2)]" aria-label={t('actions')} />
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => {
                const late = (r.lateMinutes ?? 0) > 0 ? (r.lateMinutes ?? 0) : null;
                const short = (r.shortfallMinutes ?? 0) > 0 ? (r.shortfallMinutes ?? 0) : null;
                const open = (): void => p.onOpenEmployee?.(r.id);
                return (
                  <tr
                    key={r.id}
                    onClick={open}
                    className={cn('group transition-colors hover:bg-[var(--att-sheet-2)] [&>td]:border-b [&>td]:border-[var(--att-line)] [&>td]:px-3 [&>td]:py-3', p.onOpenEmployee !== undefined && 'cursor-pointer')}
                  >
                    <td>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open();
                        }}
                        className="flex min-w-0 items-center gap-3 text-start"
                      >
                        {r.avatar ?? <PersonAvatar name={r.name} photoUrl={r.photoUrl} />}
                        <span className="min-w-0">
                          <span className={cn('block truncate text-[13.5px] font-semibold group-hover:text-[color:var(--att-accent)]', INK)}>{r.name}</span>
                          <bdi className={cn('block text-[12px]', FIG, INK3)}>{r.code}</bdi>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className={cn('block max-w-[14rem] truncate text-[13px]', INK)}>{r.jobTitle ?? '—'}</span>
                      <span className={cn('block max-w-[14rem] truncate text-[12px]', INK3)}>{r.department ?? ''}</span>
                    </td>
                    <td className={cn('whitespace-nowrap text-[13px]', INK2)}>{p.dateShort ?? ''}</td>
                    <td className="whitespace-nowrap">
                      <span className={cn('text-[13px]', FIG, r.inAt === null ? INK3 : INK)}>
                        {r.inAt === null ? '— — —' : <bdi>{clock(r.inAt)}</bdi>}
                        {r.inAt !== null && (
                          <>
                            <span className={cn('mx-1.5', INK3)}>–</span>
                            {r.outAt === null ? <span className={INK3}>—</span> : <bdi>{clock(r.outAt)}</bdi>}
                          </>
                        )}
                      </span>
                      {r.expected !== null && <span className={cn('block text-[11.5px]', INK3)}>{timeSpan(r.expected.start, r.expected.end)}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className={cn('text-[13px]', FIG, r.worked === null ? INK3 : INK)}>{r.worked === null ? '—' : shortDuration(r.worked)}</span>
                      {short !== null && (
                        <span className="block text-[11.5px] text-[color:var(--att-warn)]">
                          {t('shortfallCol')} <bdi className={FIG}>{shortDuration(short)}</bdi>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {r.overtimeDerived > 0 ? (
                        <bdi
                          className={cn('text-[13px]', FIG, r.overtimeApproved > 0 ? 'text-[color:var(--att-ok)]' : INK)}
                          title={`${t('overtime')}: ${shortDuration(r.overtimeApproved)} / ${shortDuration(r.overtimeDerived)}`}
                        >
                          {shortDuration(r.overtimeDerived)}
                        </bdi>
                      ) : (
                        <span className={INK3}>—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusPill status={r.status} label={status(r.status)} />
                      {(late !== null || r.tags.length > 0) && (
                        <span className="mt-1 flex flex-wrap gap-1 text-[11.5px]">
                          {late !== null && (
                            <span className="text-[color:var(--att-warn)]">
                              +<bdi className={FIG}>{shortDuration(late)}</bdi>
                            </span>
                          )}
                          {r.tags.map((tag) => (
                            <span key={tag} className="text-[color:var(--att-accent)]">
                              {tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>{r.actions !== undefined && <RowMenu label={t('actions')}>{r.actions}</RowMenu>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {p.rows.length === 0 && p.loading !== true && <p className={cn('px-6 py-16 text-center text-sm', INK3)}>{t('noRows')}</p>}
        {p.footer !== undefined && <div className={cn('px-5 py-3 text-sm sm:px-6', INK2)}>{p.footer}</div>}
      </Sheet>
    </AttendanceCanvas>
  );
};

const SORTS: [SheetSortKey, 'arrived' | 'left' | 'worked' | 'lateCol' | 'shortfallCol' | 'employee' | 'codeCol' | 'status'][] = [
  ['checkIn', 'arrived'],
  ['checkOut', 'left'],
  ['worked', 'worked'],
  ['late', 'lateCol'],
  ['shortfall', 'shortfallCol'],
  ['name', 'employee'],
  ['code', 'codeCol'],
  ['status', 'status'],
];

/** The rows in the order the table draws them (the server's order), for previous/next in the pop-up. */
export const boardOrder = (rows: SheetRow[]): SheetRow[] => rows;

/** A column heading; a sortable one is a button with ⇅, and the th carries aria-sort. */
const Th = ({
  label,
  sortKey,
  sort,
  onSort,
  hint,
  first = false,
}: {
  label: string;
  sortKey?: SheetSortKey;
  sort?: SheetSort | undefined;
  onSort?: ((by: SheetSortKey, dir: 'asc' | 'desc') => void) | undefined;
  hint?: (dir: 'asc' | 'desc') => string;
  first?: boolean;
}): JSX.Element => {
  const active = sortKey !== undefined && sort?.by === sortKey;
  const next: 'asc' | 'desc' = active && sort?.dir === 'asc' ? 'desc' : 'asc';
  return (
    <th
      scope="col"
      aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('whitespace-nowrap bg-[var(--att-sheet-2)] px-3 py-3 text-start text-[12.5px] font-medium', INK3, first && 'rounded-s-xl')}
    >
      {sortKey === undefined || onSort === undefined ? (
        label
      ) : (
        <button
          type="button"
          onClick={() => onSort(sortKey, next)}
          title={hint?.(next)}
          className={cn('inline-flex items-center gap-1 transition-colors hover:text-[color:var(--att-ink)]', active && INK)}
        >
          {label}
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 6.5L8 3.5l3 3" className={active && sort?.dir === 'desc' ? 'opacity-30' : ''} />
            <path d="M5 9.5l3 3 3-3" className={active && sort?.dir === 'asc' ? 'opacity-30' : ''} />
          </svg>
        </button>
      )}
    </th>
  );
};

export { num };
