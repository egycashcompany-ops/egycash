// The medical records screen — a list of PEOPLE, not of conditions (P-HR-MED D3, D12, D13).
//
// WHAT IS NOT ON THIS SCREEN is most of it. There is no condition column, no filter by diagnosis,
// no «expiring soon» band and no count of anything. «Who here is diabetic» is a query with no
// legitimate HR answer, and a screen that offered it would make this module a screening tool
// whatever the API allowed — so the API does not allow it either (see the repository) and this
// agrees with it rather than working around it.
//
// The list shows names and codes and whether a record exists. To see what a record says, you open
// one person — which is the shape somebody with a reason to look already has.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type MedicalProfileDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { SearchInput } from '../../../../shared/ui';
import { Badge } from '../../../../shared/ui/Badge';
import { useMedicalProfiles } from '../api/medical-queries';
import { MedicalProfileDialog } from '../components/MedicalProfileDialog';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'q',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const MedicalProfilesPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [open, setOpen] = useState<MedicalProfileDto | null>(null);

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const search = sp.get('q') ?? '';
  const params = { page, pageSize: DEFAULT_PAGE_SIZE, ...(search === '' ? {} : { search }) };
  const { data, isLoading, isError, error, refetch } = useMedicalProfiles(params);

  const patchParams = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };

  const columns: Column<MedicalProfileDto>[] = [
    {
      key: 'employee',
      header: t('medical.profile.employee'),
      render: (r) => (
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {r.employeeName}
          </span>
          <span className="block font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {r.employeeCode}
          </span>
        </div>
      ),
    },
    {
      // Blood type is the ONE clinical field on the list, and it earns that: it is the fact
      // somebody needs in the minute they need it, and it says nothing about anybody's history.
      key: 'bloodType',
      header: t('medical.profile.bloodType'),
      render: (r) =>
        r.bloodType === null ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <span dir="ltr" className="font-mono text-sm">
            {r.bloodType}
          </span>
        ),
    },
    {
      // WHETHER a record has content, never WHAT it says. The list must not become a way to read
      // conditions without opening a record and leaving the audit row D14 requires.
      key: 'recorded',
      header: t('medical.profile.recorded'),
      render: (r) => (
        <Badge tone={r.chronicConditions.length > 0 || r.allergies.length > 0 ? 'info' : 'neutral'}>
          {t(
            r.chronicConditions.length > 0 || r.allergies.length > 0
              ? 'medical.profile.hasDetails'
              : 'medical.profile.basicOnly',
          )}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button size="sm" variant="secondary" onClick={() => setOpen(r)}>
          {t('medical.profile.openRecord')}
        </Button>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('medical.profile.title')}
        description={t('medical.profile.subtitle')}
        breadcrumbs={[{ label: t('medical.title') }, { label: t('medical.profile.title') }]}
      />

      <div className="space-y-4">
        {/* Search is by PERSON. The placeholder says so, because a box that silently refused to
            match a condition would read as a bug rather than as a decision. */}
        <SearchInput
          value={search}
          onChange={(value) => patchParams({ q: value === '' ? null : value, page: null })}
          placeholder={t('medical.profile.searchPlaceholder')}
        />
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination meta={data.meta} onPageChange={(p) => patchParams({ page: String(p) })} />
        )}
      </div>

      {open !== null && (
        <Can permission="medicalRecord.view">
          <MedicalProfileDialog employeeId={open.employeeId} onClose={() => setOpen(null)} />
        </Can>
      )}
    </PageContainer>
  );
};
