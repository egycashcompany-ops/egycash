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
// Every number here is a QUANTITY the engine derived — worked, late, early-leave, overtime — and
// none of them is priced: pricing is Payroll's, and nothing on this screen knows a rate exists
// (§1, D5). The one write the sheet offers is the overtime APPROVAL, which releases derived
// minutes rather than valuing them, and it appears only for a caller holding the key.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AttendanceDayDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Can, useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Button, EmptyState, Pagination } from '../../../../shared/ui';
import { Input } from '../../../../shared/ui/form';
import { FilterBar } from '../../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../../shared/ui/MultiSelect';
import { readList, writeList } from '../../../../shared/lib/list-param';
import { localized, orgUnitLabel } from '../../../../shared/lib/format';
import { useBranchOptions, useSectionOptions } from '../../../organization/shared/references';
import { SheetTable } from '../components/SheetTable';
import { OvertimeApprovalDialog } from '../components/OvertimeApprovalDialog';
import { downloadAttendanceExport } from '../api/attendance-api';
import { useAttendanceSheet } from '../api/attendance-queries';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['branch', 'section'] as const;

const today = (): string => new Date().toISOString().slice(0, 10);

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
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const setPage = (next: number): void => patch({ page: next <= 1 ? null : String(next) }, false);
  const [approving, setApproving] = useState<AttendanceDayDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // No `can(...)` gate: both hooks read `/platform/<unit>/options`, which is authenticated and NOT
  // gated on `<unit>.view`. Passing the grant as the `enabled` flag left a reader of the whole
  // company's attendance with two filters that drew but offered nothing to narrow by.
  const branches = useBranchOptions();
  const sections = useSectionOptions(undefined);

  const filters = useMemo(
    () => ({
      date,
      page,
      pageSize: 50,
      ...(branchIds.length === 0 ? {} : { branchId: branchIds }),
      ...(sectionIds.length === 0 ? {} : { sectionId: sectionIds }),
    }),
    // Keyed by the lists' text: a fresh array each render is not a new filter.
    [date, branchIds.join(','), sectionIds.join(','), page],
  );
  const days = useAttendanceSheet(filters, date !== '');

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

      {/* The shared filter bar: the date stays one day; each list is as wide as its name and takes
          several picks («العرض بتاع الفلتر … يكون مظبوط ع كلام بظبط»). */}
      <div className="mb-4">
        <FilterBar
          onClear={() => patch({ branch: null, section: null })}
          hasActiveFilters={branchIds.length > 0 || sectionIds.length > 0}
        >
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
            options={(branches.data ?? []).map((b) => ({ value: b.id, label: localized(b.name, locale) }))}
          />
          <MultiSelect
            label={t('attendance.daily.section')}
            value={sectionIds}
            onChange={(next) => patch({ section: writeList(next) })}
            options={(sections.data ?? []).map((s) => ({ value: s.id, label: orgUnitLabel(s, locale) }))}
          />
        </FilterBar>
      </div>

      {exportError !== null && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {exportError}
        </p>
      )}

      <SheetTable
        rows={days.data?.items ?? []}
        loading={days.isLoading}
        error={days.isError ? days.error : undefined}
        onRetry={() => void days.refetch()}
        empty={<EmptyState title={t('attendance.daily.empty')} />}
        rowActions={(row) =>
          // The approval is offered only where it can succeed: a derived surplus, an unfrozen
          // row, and the key in hand. A line with no day row has nothing to approve — there is no
          // version to send and no overtime to release.
          can('attendance.approveOvertime') &&
          row.day !== null &&
          row.day.overtimeMinutes > 0 &&
          row.day.frozenAt === null ? (
            <Button size="sm" variant="secondary" onClick={() => setApproving(row.day)}>
              {t('attendance.overtime.approve')}
            </Button>
          ) : null
        }
      />

      {days.data !== undefined && (
        <Pagination meta={days.data.meta} onPageChange={setPage} />
      )}

      {approving !== null && (
        <OvertimeApprovalDialog day={approving} onClose={() => setApproving(null)} />
      )}
    </PageContainer>
  );
};
