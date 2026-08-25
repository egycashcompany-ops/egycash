// Job requisitions — the queue of requests to hire (P-HR-REQ).
//
// TWO COLUMNS CARRY THE WHOLE POINT OF THIS SCREEN. `filled / quantity` says how much of a request
// is still open, and it is the SERVER's count of hire records rather than anything this page adds
// up; and the status pill says where the request stands in one chain, so "approved but not hiring"
// is not a state anybody has to reconstruct from two fields.
//
// The catalog labels (job title, department, branch) are ids on the DTO — a requisition stores the
// reference, not the name, so a renamed department renames itself everywhere rather than leaving
// this list stating what a row used to say.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  JOB_REQUISITION_PRIORITIES,
  JOB_REQUISITION_STATUSES,
  MAX_PAGE_SIZE,
  type JobRequisitionDto,
  type JobRequisitionPriority,
  type JobRequisitionStatus,
  type Locale,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { useQuery } from '@tanstack/react-query';
import { Can } from '../../../../../platform/rbac/Can';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Button, Card, CardBody, DataTable, Dialog, EmptyState } from '../../../../../shared/ui';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { get } from '../../../../../shared/lib/api-client';
import { formatDate, localized } from '../../../../../shared/lib/format';
import { useCreateJobRequisition, useJobRequisitions } from '../api/job-requisition-queries';
import { RequisitionStatusBadge } from '../components/RequisitionStatusBadge';
import {
  RequisitionForm,
  emptyDraft,
  isComplete,
  toCreate,
  type RequisitionDraft,
} from '../components/RequisitionForm';

const orgOptions = (path: string): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>(`/platform/${path}/options`);

export const JobRequisitionsListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [status, setStatus] = useState<JobRequisitionStatus | ''>('');
  const [priority, setPriority] = useState<JobRequisitionPriority | ''>('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<RequisitionDraft | null>(null);

  const rows = useJobRequisitions({
    pageSize: MAX_PAGE_SIZE,
    ...(status === '' ? {} : { status }),
    ...(priority === '' ? {} : { priority }),
    ...(search.trim() === '' ? {} : { search: search.trim() }),
  });
  const departments = useQuery({
    queryKey: ['org', 'departments'],
    queryFn: () => orgOptions('departments'),
  });

  const create = useCreateJobRequisition();

  const departmentName = (id: string): string => {
    const unit = (departments.data ?? []).find((option) => option.id === id);
    return unit === undefined ? '—' : localized(unit.name, locale);
  };

  const save = async (): Promise<void> => {
    if (draft === null || !isComplete(draft)) return;
    try {
      await create.mutateAsync(toCreate(draft));
      toast.success(t('hr.requisitions.created'));
      setDraft(null);
    } catch {
      toast.error(t('hr.requisitions.saveFailed'));
    }
  };

  const field = 'rounded-lg border border-slate-200 px-3 py-2 text-sm';

  return (
    <PageContainer>
      <PageHeader
        title={t('hr.requisitions.title')}
        description={t('hr.requisitions.subtitle')}
        actions={
          <Can permission="jobRequisition.create">
            <Button onClick={() => setDraft(emptyDraft())}>{t('hr.requisitions.new')}</Button>
          </Can>
        }
      />

      <Card>
        <CardBody className="flex flex-wrap gap-3">
          <input
            className={field}
            placeholder={t('hr.requisitions.filters.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={field}
            value={status}
            onChange={(e) => setStatus(e.target.value as JobRequisitionStatus | '')}
          >
            <option value="">{t('hr.requisitions.filters.allStatuses')}</option>
            {JOB_REQUISITION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`hr.requisitions.status.${value}`)}
              </option>
            ))}
          </select>
          <select
            className={field}
            value={priority}
            onChange={(e) => setPriority(e.target.value as JobRequisitionPriority | '')}
          >
            <option value="">{t('hr.requisitions.filters.allPriorities')}</option>
            {JOB_REQUISITION_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`hr.requisitions.priority.${value}`)}
              </option>
            ))}
          </select>
        </CardBody>
      </Card>

      <DataTable<JobRequisitionDto>
        rows={rows.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={rows.isLoading}
        error={rows.error}
        onRetry={() => void rows.refetch()}
        empty={
          <EmptyState
            title={t('hr.requisitions.empty.title')}
            description={t('hr.requisitions.empty.body')}
          />
        }
        columns={[
          {
            key: 'code',
            header: t('hr.requisitions.columns.code'),
            render: (row) => (
              <Link className="font-medium text-brand-700" to={`/job-requisitions/${row.id}`}>
                {row.code}
              </Link>
            ),
          },
          {
            key: 'department',
            header: t('hr.requisitions.columns.department'),
            render: (row) => departmentName(row.departmentId),
          },
          {
            key: 'filled',
            header: t('hr.requisitions.columns.filled'),
            render: (row) => `${String(row.filledCount)} / ${String(row.quantity)}`,
          },
          {
            key: 'priority',
            header: t('hr.requisitions.columns.priority'),
            render: (row) => t(`hr.requisitions.priority.${row.priority}`),
          },
          {
            key: 'neededBy',
            header: t('hr.requisitions.columns.neededBy'),
            render: (row) => (row.neededBy === null ? '—' : formatDate(row.neededBy, locale)),
          },
          {
            key: 'status',
            header: t('hr.requisitions.columns.status'),
            render: (row) => <RequisitionStatusBadge status={row.status} />,
          },
        ]}
      />

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={t('hr.requisitions.new')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void save()}
              disabled={draft === null || !isComplete(draft) || create.isPending}
            >
              {t('common.save')}
            </Button>
          </div>
        }
      >
        {draft === null ? null : (
          <RequisitionForm draft={draft} onChange={setDraft} existing={null} />
        )}
      </Dialog>
    </PageContainer>
  );
};
