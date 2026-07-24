// Approvals inbox (frozen design §11): the union of the caller's MANAGER queue (their direct
// reports, matched by relationship) and the HR queue (leave.approve in scope). Decisions
// happen on the detail page — the inbox is the worklist.
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { EmptyState } from '../../../../shared/ui';
import { usePendingApprovals } from '../api/leave-queries';
import { RequestsTable } from '../components/RequestsTable';

export const ApprovalsInboxPage = (): JSX.Element => {
  const t = useT();
  const { data, isLoading, isError, refetch } = usePendingApprovals();
  return (
    <PageContainer>
      <PageHeader
        title={t('leave.approvals.title')}
        description={t('leave.approvals.subtitle')}
        breadcrumbs={[{ label: t('leave.module.title'), to: '/leave' }, { label: t('leave.approvals.title') }]}
      />
      <RequestsTable
        rows={data ?? []}
        loading={isLoading}
        error={isError}
        onRetry={() => void refetch()}
        showEmployee
        empty={<EmptyState title={t('leave.approvals.empty')} />}
      />
    </PageContainer>
  );
};
