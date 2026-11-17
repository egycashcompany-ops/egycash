// The daily sheet (AT-6, frozen design v1.1 §10): one branch/section on one date, read-only.
//
// IT LISTS PEOPLE, NOT ROWS, and that is a correctness fix rather than a presentation choice. It
// used to read the day list, which filters day DOCUMENTS — so an employee the engine had written
// no row for was missing from the sheet instead of showing as not-yet-in. The branch servers
// recompute only the employees who scanned, so the people this screen is opened to find were
// exactly the people it could not show, and the sheet reported near-perfect attendance every
// morning by construction. `/hr/attendance/days/sheet` starts from the employees and resolves
// «لم يحضر بعد» / «غائب» from the clock against the hour they were due — writing nothing.
//
// THE REDESIGN (stage 6) is built out of what the system already has: `ListView` is the house
// list surface, `StatStrip` is its summary band, and the cells of that band are the status
// filter — a count you can press is the shortest path from "eighteen absent" to "which eighteen".
// No new colour and no new library: the tones are the same six the rest of the product uses.
//
// Every number here is a QUANTITY the engine derived — worked, late, early-leave, overtime — and
// none of them is priced: pricing is Payroll's, and nothing on this screen knows a rate exists
// (§1, D5).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  type AttendanceDayDto,
  type AttendanceDayStatus,
  type AttendanceSheetRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Can, useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Button, EmptyState, ListView, Pagination, StatStrip } from '../../../../shared/ui';
import { DebouncedInput } from '../../../../shared/ui/DebouncedInput';
import { Input } from '../../../../shared/ui/form';
import { MultiSelect } from '../../../../shared/ui/MultiSelect';
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  HistoryIcon,
  UsersIcon,
} from '../../../../shared/ui/icons';
import { readList, writeList } from '../../../../shared/lib/list-param';
import { localized, orgUnitLabel } from '../../../../shared/lib/format';
import { useBranchOptions, useSectionOptions } from '../../../organization/shared/references';
import { SheetTable } from '../components/SheetTable';
import { SheetCards } from '../components/SheetCards';
import { OvertimeApprovalDialog } from '../components/OvertimeApprovalDialog';
import { DayDecisionDialog } from '../components/DayDecisionDialog';
import { downloadAttendanceExport } from '../api/attendance-api';
import { useAttendanceSheet, useAttendanceSheetSummary } from '../api/attendance-queries';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['branch', 'section', 'status', 'q'] as const;

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * The five cards, and which statuses each one counts.
 *
 * THE GROUPING LIVES HERE, not on the server, which returns every status separately. `late` is a
 * presence — the person is at work — but a supervisor scanning this band wants it called out, so
 * it gets its own cell rather than being folded into «حاضر». Fold it in and the screen can no
 * longer answer the question it is opened for; a count the server had already blended could not
 * be unblended at all.
 *
 * `checkedIn` sits with `present`: on this payroll most people scan on arrival and never scan
 * out, so an arrival alone IS the ordinary present day.
 */
const CARDS = [
  { key: 'all', icon: UsersIcon, statuses: [] as AttendanceDayStatus[] },
  { key: 'present', icon: CheckIcon, statuses: ['present', 'checkedIn'] as AttendanceDayStatus[] },
  {
    key: 'late',
    icon: AlertIcon,
    statuses: ['late', 'lateAndEarly', 'earlyLeave'] as AttendanceDayStatus[],
  },
  { key: 'pending', icon: HistoryIcon, statuses: ['pending'] as AttendanceDayStatus[] },
  { key: 'absent', icon: CloseIcon, statuses: ['absent'] as AttendanceDayStatus[] },
] as const;

export const DailySheetPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [date, setDate] = useState(today);
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
      ...(statuses.length === 0 ? {} : { status: statuses }),
    }),
    [scopeFilters, page, statuses.join(',')],
  );
  const days = useAttendanceSheet(filters, date !== '');
  // Deliberately NOT narrowed by the status filter: the band is what the filter is chosen FROM, so
  // pressing «غائب» must not collapse every other count to zero.
  const summary = useAttendanceSheetSummary(scopeFilters, date !== '');

  const countFor = (statusesOfCard: readonly AttendanceDayStatus[]): string | undefined => {
    const data = summary.data;
    if (data === undefined) return undefined;
    if (statusesOfCard.length === 0) return String(data.total);
    return String(statusesOfCard.reduce((sum, status) => sum + (data.byStatus[status] ?? 0), 0));
  };

  /** Pressing a card applies its statuses; pressing the applied one clears back to everybody. */
  const toggleCard = (statusesOfCard: readonly AttendanceDayStatus[]): void => {
    const next = writeList([...statusesOfCard]);
    patch({ status: next === writeList(statuses) ? null : next });
  };

  const runExport = (): void => {
    setExporting(true);
    setExportError(null);
    downloadAttendanceExport({
      from: date,
      to: date,
      ...(branchIds.length === 0 ? {} : { branchId: branchIds }),
      ...(sectionIds.length === 0 ? {} : { sectionId: sectionIds }),
    })
      .catch((error: unknown) => {
        setExportError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setExporting(false));
  };

  const rows = days.data?.items ?? [];
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
    return parts.length === 0 ? null : <span className="flex gap-2">{parts}</span>;
  };

  const hasFilters =
    branchIds.length > 0 || sectionIds.length > 0 || statuses.length > 0 || search !== '';

  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.daily.title')}
        breadcrumbs={[{ label: t('attendance.module.title') }, { label: t('attendance.daily.title') }]}
        actions={
          <Can permission="attendance.export">
            <Button size="sm" variant="secondary" loading={exporting} onClick={runExport}>
              {t('attendance.daily.export')}
            </Button>
          </Can>
        }
      />

      {exportError !== null && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {exportError}
        </p>
      )}

      <ListView
        summary={
          <StatStrip
            columns={5}
            items={CARDS.map((card) => ({
              key: card.key,
              label: t(`attendance.daily.card.${card.key}`),
              icon: card.icon,
              ...(countFor(card.statuses) === undefined
                ? {}
                : { value: countFor(card.statuses) as string }),
              loading: summary.isLoading,
              // «الكل» is the cleared view rather than a filter of its own.
              onClick: () => toggleCard(card.statuses),
              active:
                card.statuses.length === 0
                  ? statuses.length === 0
                  : writeList([...card.statuses]) === writeList(statuses),
            }))}
          />
        }
        search={
          <DebouncedInput
            value={search}
            onValueChange={(value) => patch({ q: value })}
            placeholder={t('attendance.daily.search')}
            aria-label={t('attendance.daily.search')}
            className="w-full sm:w-56"
          />
        }
        filters={
          <>
            <label className="flex items-center gap-1.5 text-sm text-slate-500">
              <span className="hidden whitespace-nowrap sm:inline">{t('attendance.daily.date')}</span>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setPage(1);
                }}
                aria-label={t('attendance.daily.date')}
                dir="ltr"
                className="w-auto"
              />
            </label>
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
          </>
        }
        total={days.data?.meta.totalItems}
        hasActiveFilters={hasFilters}
        onClear={() => patch({ branch: null, section: null, status: null, q: null })}
        pagination={
          days.data === undefined ? undefined : (
            <Pagination meta={days.data.meta} onPageChange={setPage} />
          )
        }
      >
        {/* The same rows, laid out for the screen they are on: a seven-column grid a phone has to
            be dragged sideways through answers "who is not here yet" far worse than a stack. */}
        <div className="hidden sm:block">
          <SheetTable
            rows={rows}
            loading={days.isLoading}
            error={days.isError ? days.error : undefined}
            onRetry={() => void days.refetch()}
            empty={<EmptyState title={t('attendance.daily.empty')} />}
            rowActions={rowActions}
          />
        </div>
        <div className="sm:hidden">
          {rows.length === 0 && !days.isLoading ? (
            <div className="p-4">
              <EmptyState title={t('attendance.daily.empty')} />
            </div>
          ) : (
            <SheetCards rows={rows} rowActions={rowActions} />
          )}
        </div>
      </ListView>

      {approving !== null && (
        <OvertimeApprovalDialog day={approving} onClose={() => setApproving(null)} />
      )}

      {deciding !== null && (
        <DayDecisionDialog row={deciding} onClose={() => setDeciding(null)} />
      )}
    </PageContainer>
  );
};
