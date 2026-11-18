// «الحضور اليومي» — one branch-day, read from the database and drawn by `DailySheetView`.
//
// THE PAGE OWNS THE DATA AND THE CONTROLS; THE VIEW ONLY DRAWS. Every figure on the screen comes
// from the API: the six counters and their shares, the arrival chart, the start of the working day
// and its grace, the last scan, and every row. Nothing is computed here that the server has not
// sent, and nothing is assumed — a sheet whose people have no roster draws no «بداية الدوام» line
// rather than a line at nine o'clock nobody set.
//
// IT LISTS PEOPLE, NOT ROWS. `listDays` filters day DOCUMENTS, so an employee the engine has
// written no row for would be missing from the answer instead of shown as absent from work — and
// the branch servers recompute only the people who scanned, so the ones this screen exists to find
// are exactly the ones with no row. `/days/sheet` starts from the employees and resolves «لم يحضر
// بعد» / «غائب» from the clock against the hour they were due, writing nothing.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ATTENDANCE_SHEET_SORTS,
  type AttendanceDayDto,
  type AttendanceDayStatus,
  type AttendanceSheetRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer } from '../../../../platform/layout/PageContainer';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Button, Pagination } from '../../../../shared/ui';
import { DebouncedInput } from '../../../../shared/ui/DebouncedInput';
import { Input } from '../../../../shared/ui/form';
import { MultiSelect } from '../../../../shared/ui/MultiSelect';
import { readList, writeList } from '../../../../shared/lib/list-param';
import { localized, orgUnitLabel } from '../../../../shared/lib/format';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';
import { useBranchOptions, useSectionOptions } from '../../../organization/shared/references';
import { OvertimeApprovalDialog } from '../components/OvertimeApprovalDialog';
import { DayDecisionDialog } from '../components/DayDecisionDialog';
import { downloadAttendanceExport } from '../api/attendance-api';
import { useAttendanceSheet, useAttendanceSheetSummary } from '../api/attendance-queries';
import { addDays } from '../components/period';
import { cairoNowMinutes, cairoToday, toSheetRow } from '../view-model';
import { DailySheetView, type SheetFilter, type SheetSortKey } from '../views';
import { exportFileName, soleBranchName } from '../export-name';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['branch', 'section', 'status', 'q'] as const;

/**
 * Which day statuses each counter stands for.
 *
 * THE GROUPING LIVES HERE, not on the server, which counts all thirteen separately. `late` is a
 * presence — the person is at work — but a supervisor scanning the band wants it called out, so it
 * is its own counter; a count the server had already blended could not be unblended by a reader
 * who wanted the other grouping. `checkedIn` sits with `present`: on this payroll most people scan
 * on arrival and never scan out, so an arrival alone IS the ordinary present day.
 */
export const FILTER_STATUSES: Record<Exclude<SheetFilter, 'all'>, AttendanceDayStatus[]> = {
  present: ['present', 'checkedIn'],
  late: ['late', 'lateAndEarly', 'earlyLeave'],
  notYetIn: ['pending'],
  absent: ['absent'],
  onLeave: ['onLeave'],
  // An open question for HR: the roster is incomplete, so no punctuality figure exists for them.
  noSchedule: ['noSchedule'],
  // `incomplete` sits here on purpose. It is a legacy value nothing derives any more, and on a
  // live sheet it means exactly what `noRecord` means — a day nothing current has concluded.
  noRecord: ['noRecord', 'incomplete'],
  // The three ways a date is genuinely not a working day for somebody.
  offDay: ['weekend', 'holiday', 'dayOff'],
};

/**
 * EVERY STATUS IS IN EXACTLY ONE COUNTER, and this proves it rather than trusting the list above.
 *
 * The defect it guards against is not hypothetical: the grouping covered eight of the statuses and
 * the server counted thirteen, so five of them were invisible and the band disagreed with its own
 * total. A status added to contracts and not to a counter here would silently repeat that, and a
 * status in two counters would double-count people — so the test asserts both directions against
 * `ATTENDANCE_DAY_STATUSES` itself.
 */
export const COUNTED_STATUSES: readonly AttendanceDayStatus[] = Object.values(FILTER_STATUSES).flat();

export const DailySheetPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [date, setDate] = useState(cairoToday);
  // The filters live in the URL so the screen is shareable and survives a reload — and so the
  // remembered-filters hook has something to remember. Written with `replace`, because narrowing a
  // list is a view of this screen rather than a place to go Back to.
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(name);
      else next.set(name, value);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next, { replace: true });
  };

  // «هنخلي كل الفلترز multi»: several branches and several sections, each ORed, as comma lists.
  const branchIds = readList(sp, 'branch');
  const sectionIds = readList(sp, 'section');
  const statuses = readList(sp, 'status') as AttendanceDayStatus[];
  const search = sp.get('q') ?? '';
  /**
   * THE ORDER, IN THE URL — so a refresh, the Back button and a pasted link all keep it, which is
   * what the owner asked for. Read defensively: anything the vocabulary does not contain falls
   * back to the default rather than travelling to the server to be refused.
   */
  const sortBy: SheetSortKey = (ATTENDANCE_SHEET_SORTS as readonly string[]).includes(
    sp.get('sort') ?? '',
  )
    ? (sp.get('sort') as SheetSortKey)
    : 'checkIn';
  const sortDir: 'asc' | 'desc' = sp.get('dir') === 'desc' ? 'desc' : 'asc';
  const onSort = (by: SheetSortKey, dir: 'asc' | 'desc'): void =>
    patch({
      // The default order is left OUT of the URL rather than written into it, so the address stays
      // clean until somebody actually changes something.
      sort: by === 'checkIn' && dir === 'asc' ? null : by,
      dir: by === 'checkIn' && dir === 'asc' ? null : dir,
    });
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const setPage = (next: number): void => patch({ page: next <= 1 ? null : String(next) }, false);
  const [approving, setApproving] = useState<AttendanceDayDto | null>(null);
  const [deciding, setDeciding] = useState<AttendanceSheetRowDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // No `can(...)` gate: both hooks read `/platform/<unit>/options`, which is authenticated and NOT
  // gated on `<unit>.view`. Passing the grant as the `enabled` flag left a reader of the whole
  // company's attendance with two filters that drew but offered nothing to narrow by.
  const branches = useBranchOptions();
  const sections = useSectionOptions(undefined);

  /** What both reads narrow by. The status filter is the sheet's alone — the counts never narrow. */
  const scopeFilters = useMemo(
    () => ({
      date,
      ...(branchIds.length === 0 ? {} : { branchId: branchIds }),
      ...(sectionIds.length === 0 ? {} : { sectionId: sectionIds }),
      ...(search === '' ? {} : { search }),
    }),
    // Keyed by the lists' text: a fresh array each render is not a new filter.
    [date, branchIds.join(','), sectionIds.join(','), search],
  );
  const filters = useMemo(
    () => ({
      ...scopeFilters,
      page,
      pageSize: 50,
      sortBy,
      sortDir,
      ...(statuses.length === 0 ? {} : { status: statuses }),
    }),
    [scopeFilters, page, sortBy, sortDir, statuses.join(',')],
  );
  const days = useAttendanceSheet(filters, date !== '');
  // Deliberately NOT narrowed by the status filter: the band is what the filter is chosen FROM, so
  // pressing «غائب» must not collapse every other count to zero.
  const summary = useAttendanceSheetSummary(scopeFilters, date !== '');

  const counts = summary.data;
  const countOf = (key: Exclude<SheetFilter, 'all'>): number =>
    counts === undefined
      ? 0
      : FILTER_STATUSES[key].reduce((sum, status) => sum + (counts.byStatus[status] ?? 0), 0);

  /** Which counter is currently applied — read back from the URL, so a reload keeps it. */
  const activeFilter: SheetFilter = useMemo(() => {
    if (statuses.length === 0) return 'all';
    const applied = writeList([...statuses]);
    const match = (Object.keys(FILTER_STATUSES) as Exclude<SheetFilter, 'all'>[]).find(
      (key) => writeList([...FILTER_STATUSES[key]]) === applied,
    );
    return match ?? 'all';
  }, [statuses.join(',')]);

  const onFilter = (next: SheetFilter): void => {
    // Pressing the applied counter again clears back to everybody, which is what «عرض الكل» does.
    patch({
      status:
        next === 'all' || next === activeFilter ? null : writeList([...FILTER_STATUSES[next]]),
    });
  };

  const goToDay = (step: number): void => {
    setDate((current) => addDays(current, step));
    setPage(1);
  };

  const runExport = (): void => {
    // A second press while the first file is still being built would download the same day twice.
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    // THE FILE IS WHAT IS ON SCREEN: the same date, branches, sections, status buckets, search
    // box AND order. It used to send only the date and the two id lists, so a reader who had
    // filtered to «غائب» and sorted by arrival got an unfiltered file ordered by employee code.
    downloadAttendanceExport(
      {
        from: date,
        to: date,
        sortBy,
        sortDir,
        ...(branchIds.length === 0 ? {} : { branchId: branchIds }),
        ...(sectionIds.length === 0 ? {} : { sectionId: sectionIds }),
        ...(statuses.length === 0 ? {} : { status: statuses }),
        ...(search === '' ? {} : { search }),
      },
      exportFileName(date, date, soleBranchName(branchIds, branches.data, locale)),
    )
      .catch((error: unknown) => {
        setExportError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setExporting(false));
  };

  const rowActions = (row: AttendanceSheetRowDto): JSX.Element | null => {
    const parts: JSX.Element[] = [];
    // Deciding needs no day row — the commonest case for it is somebody with no row at all — but
    // a frozen day is refused by the server, so it is not offered.
    if (can('attendance.decide') && (row.day === null || row.day.frozenAt === null)) {
      parts.push(
        <Button key="decide" size="sm" variant="secondary" onClick={() => setDeciding(row)}>
          {t('attendance.decision.action')}
        </Button>,
      );
    }
    // The approval is offered only where it can succeed: a derived surplus, an unfrozen row, and
    // the key in hand. A line with no day row has nothing to approve — no version, no overtime.
    if (
      can('attendance.approveOvertime') &&
      row.day !== null &&
      row.day.overtimeMinutes > 0 &&
      row.day.frozenAt === null
    ) {
      const day = row.day;
      parts.push(
        <Button key="ot" size="sm" variant="secondary" onClick={() => setApproving(day)}>
          {t('attendance.overtime.approve')}
        </Button>,
      );
    }
    return parts.length === 0 ? null : <>{parts}</>;
  };

  const today = cairoToday();
  const rows = (days.data?.items ?? []).map((row) =>
    toSheetRow(row, { today, locale, label: t, actions: rowActions(row) ?? undefined }),
  );

  const dateTitle = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));

  /** «منذ دقيقتين» — the browser's own relative formatter, from the real scan time. */
  const lastScan = useMemo(() => {
    const at = counts?.lastPunchAt ?? null;
    if (at === null) return null;
    const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      numeric: 'auto',
    });
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour');
    return rtf.format(-Math.round(minutes / (60 * 24)), 'day');
  }, [counts?.lastPunchAt, locale]);

  return (
    <PageContainer>
      {exportError !== null && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {exportError}
        </p>
      )}

      <DailySheetView
        dateTitle={dateTitle}
        dateInput={
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value === '') return;
              setDate(e.target.value);
              setPage(1);
            }}
            aria-label={t('attendance.daily.date')}
            dir="ltr"
            className="w-auto border-0 bg-transparent px-1 py-0 focus:ring-0"
          />
        }
        onPrevDay={() => goToDay(-1)}
        onNextDay={() => goToDay(1)}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <DebouncedInput
              value={search}
              onValueChange={(value) => patch({ q: value })}
              placeholder={t('attendance.daily.search')}
              aria-label={t('attendance.daily.search')}
              className="w-full sm:w-64"
            />
            <MultiSelect
              label={t('attendance.daily.branch')}
              value={branchIds}
              onChange={(next) => patch({ branch: writeList(next) })}
              options={(branches.data ?? []).map((b) => ({
                value: b.id,
                label: localized(b.name, locale),
              }))}
            />
            <MultiSelect
              label={t('attendance.daily.section')}
              value={sectionIds}
              onChange={(next) => patch({ section: writeList(next) })}
              options={(sections.data ?? []).map((s) => ({
                value: s.id,
                label: orgUnitLabel(s, locale),
              }))}
            />
          </div>
        }
        summary={{
          employees: counts?.total ?? 0,
          noSchedule: countOf('noSchedule'),
          noRecord: countOf('noRecord'),
          offDay: countOf('offDay'),
          // The scans this sheet CANNOT show: machine ids linked to nobody. Not part of `total`,
          // because ECMS does not know who they are — which is exactly why the page has to say it.
          unlinked: counts?.unlinkedScans ?? null,
          present: countOf('present'),
          late: countOf('late'),
          notYetIn: countOf('notYetIn'),
          absent: countOf('absent'),
          onLeave: countOf('onLeave'),
        }}
        arrivals={counts?.arrivals ?? []}
        dayStart={counts?.dayStart ?? null}
        grace={counts?.graceMinutes ?? 0}
        // The marker is drawn only on the day being lived; on any other date "now" is not a fact
        // about the sheet, and a line through yesterday at this hour would mean nothing.
        now={date === today ? cairoNowMinutes() : null}
        lastScan={lastScan}
        activeFilter={activeFilter}
        onFilter={onFilter}
        rows={rows}
        loading={days.isLoading}
        footer={
          days.data === undefined ? undefined : (
            <Pagination meta={days.data.meta} onPageChange={setPage} />
          )
        }
        sort={{ by: sortBy, dir: sortDir }}
        onSort={onSort}
        {...(can('attendance.export') ? { onExport: runExport } : {})}
        onOpenEmployee={(id) => navigate(`/attendance/employees/${id}?from=${date}&to=${date}`)}
      />

      {approving !== null && (
        <OvertimeApprovalDialog day={approving} onClose={() => setApproving(null)} />
      )}

      {deciding !== null && <DayDecisionDialog row={deciding} onClose={() => setDeciding(null)} />}
    </PageContainer>
  );
};
