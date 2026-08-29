// Medical insurance cards (P-HR-MED D2, D10, D13).
//
// A BENEFIT REGISTER, NOT A CLAIMS SCREEN. There are no claims here, no reimbursements and no
// balances — that is an accounting boundary and a different product that happens to share a noun.
// What this answers is «who is covered, by whom, under what number, and until when».
//
// NOTHING IS COLOURED BY A DATE (D13). A card whose window has passed still reads `active`, because
// «expired» is a conclusion drawn from a date and this module draws none. Ending a card is
// somebody's act, and the screen shows the state a person set rather than one it inferred — which
// looks odd until you ask what the alternative would do: tell a clinic somebody is uninsured on the
// authority of a cron job.
import { useState } from 'react';
import { type InsuranceCardDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { SearchInput } from '../../../../shared/ui';
import { StatusBadge, type Tone } from '../../../../shared/ui/Badge';
import { formatDate } from '../../../../shared/lib/format';
import { useInsuranceCards } from '../api/medical-queries';
import { InsuranceCardDialog } from '../components/InsuranceCardDialog';

const DEFAULT_PAGE_SIZE = 25;

const STATUS_TONE: Record<InsuranceCardDto['status'], Tone> = {
  active: 'success',
  ended: 'neutral',
};

export const InsuranceCardsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useState(() => new URLSearchParams());
  const [editing, setEditing] = useState<InsuranceCardDto | null>(null);
  const [issuing, setIssuing] = useState(false);

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const search = sp.get('q') ?? '';
  const params = { page, pageSize: DEFAULT_PAGE_SIZE, ...(search === '' ? {} : { search }) };
  const { data, isLoading, isError, error, refetch } = useInsuranceCards(params);

  const patchParams = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };

  const columns: Column<InsuranceCardDto>[] = [
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
    { key: 'provider', header: t('medical.insurance.provider'), render: (r) => r.provider },
    {
      key: 'cardNumber',
      header: t('medical.insurance.cardNumber'),
      render: (r) => (
        <span className="font-mono text-sm" dir="ltr">
          {r.cardNumber}
        </span>
      ),
    },
    {
      key: 'tier',
      header: t('medical.insurance.tier'),
      render: (r) => r.tier ?? <span className="text-xs text-slate-400">—</span>,
    },
    {
      key: 'window',
      header: t('medical.insurance.window'),
      // Printed plainly. Not coloured when the end date has passed (D13).
      render: (r) => (
        <span dir="ltr" className="text-xs">
          {`${formatDate(r.startsOn, locale)} — ${r.endsOn === null ? '…' : formatDate(r.endsOn, locale)}`}
        </span>
      ),
    },
    {
      key: 'dependants',
      header: t('medical.insurance.dependants'),
      render: (r) => <span dir="ltr">{r.dependants.length}</span>,
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => (
        <StatusBadge
          tone={STATUS_TONE[r.status]}
          label={t(`medical.insurance.status.${r.status}`)}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Can permission="medicalInsurance.manage">
          {r.status === 'active' && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
              {t('medical.insurance.manage')}
            </Button>
          )}
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('medical.insurance.title')}
        description={t('medical.insurance.subtitle')}
        breadcrumbs={[{ label: t('medical.title') }, { label: t('medical.insurance.title') }]}
        actions={
          <Can permission="medicalInsurance.manage">
            <Button onClick={() => setIssuing(true)}>{t('medical.insurance.issue')}</Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <SearchInput
          value={search}
          onChange={(value) => patchParams({ q: value === '' ? null : value, page: null })}
          placeholder={t('medical.insurance.searchPlaceholder')}
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

      {(editing !== null || issuing) && (
        <InsuranceCardDialog
          card={editing}
          onClose={() => {
            setEditing(null);
            setIssuing(false);
          }}
        />
      )}
    </PageContainer>
  );
};
