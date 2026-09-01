// The daily sheet (AT-6, frozen design v1.1 §10): one branch/section on one date, read-only.
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
import { Field, Input, Select } from '../../../../shared/ui/form';
import { localized } from '../../../../shared/lib/format';
import { useBranchOptions, useSectionOptions } from '../../../organization/shared/references';
import { DaysTable } from '../components/DaysTable';
import { OvertimeApprovalDialog } from '../components/OvertimeApprovalDialog';
import { downloadAttendanceExport } from '../api/attendance-api';
import { useAttendanceDays } from '../api/attendance-queries';
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

  const branchId = sp.get('branch') ?? '';
  const setBranchId = (value: string): void => patch({ branch: value });
  const sectionId = sp.get('section') ?? '';
  const setSectionId = (value: string): void => patch({ section: value });
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const setPage = (next: number): void => patch({ page: next <= 1 ? null : String(next) }, false);
  const [approving, setApproving] = useState<AttendanceDayDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const branches = useBranchOptions(can('branch.view'));
  const sections = useSectionOptions(undefined, can('section.view'));

  const filters = useMemo(
    () => ({
      from: date,
      to: date,
      page,
      pageSize: 50,
      ...(branchId === '' ? {} : { branchId }),
      ...(sectionId === '' ? {} : { sectionId }),
    }),
    [date, branchId, sectionId, page],
  );
  const days = useAttendanceDays(filters, date !== '');

  const runExport = (): void => {
    setExporting(true);
    setExportError(null);
    downloadAttendanceExport({
      from: date,
      to: date,
      ...(branchId === '' ? {} : { branchId }),
      ...(sectionId === '' ? {} : { sectionId }),
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
        description={t('attendance.daily.subtitle')}
        breadcrumbs={[{ label: t('attendance.module.title') }, { label: t('attendance.daily.title') }]}
        actions={
          <Can permission="attendance.export">
            <Button size="sm" variant="secondary" loading={exporting} onClick={runExport}>
              {t('attendance.daily.export')}
            </Button>
          </Can>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('attendance.daily.date')}>
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
            aria-label={t('attendance.daily.date')}
          />
        </Field>
        <Field label={t('attendance.daily.branch')}>
          <Select
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setPage(1);
            }}
            aria-label={t('attendance.daily.branch')}
          >
            <option value="">{t('attendance.daily.allBranches')}</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {localized(b.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('attendance.daily.section')}>
          <Select
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              setPage(1);
            }}
            aria-label={t('attendance.daily.section')}
          >
            <option value="">{t('attendance.daily.allSections')}</option>
            {(sections.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {exportError !== null && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {exportError}
        </p>
      )}

      <DaysTable
        rows={days.data?.items ?? []}
        loading={days.isLoading}
        error={days.isError ? days.error : undefined}
        onRetry={() => void days.refetch()}
        showEmployee
        empty={<EmptyState title={t('attendance.daily.empty')} />}
        rowActions={(row) =>
          // The approval is offered only where it can succeed: a derived surplus, an unfrozen
          // row, and the key in hand. A frozen day's correction flows forward as an adjustment.
          can('attendance.approveOvertime') && row.overtimeMinutes > 0 && row.frozenAt === null ? (
            <Button size="sm" variant="secondary" onClick={() => setApproving(row)}>
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
