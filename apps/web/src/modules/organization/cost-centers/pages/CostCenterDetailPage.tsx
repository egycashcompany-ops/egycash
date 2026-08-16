// One cost centre: what it is called and whether it is still in use.
//
// It shows no members. Membership is dated and per-employee (D-CC-1), so a list here would have to
// choose a date to be truthful — and "as of when?" is a question a catalog screen cannot answer.
// The employee's own file shows their history, which is where the question has an owner.
import { useNavigate, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { localized } from '../../../../shared/lib/format';
import { useCostCenter } from '../cost-center-queries';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="text-end">{children}</dd>
  </div>
);

export const CostCenterDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { data: cc, isLoading, isError, error, refetch } = useCostCenter(id);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || cc === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const dash = '—';

  return (
    <PageContainer>
      <PageHeader
        title={localized(cc.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.costCenters'), to: '/organization/cost-centers' },
          { label: cc.code },
        ]}
        actions={
          <Can permission="costCenter.edit">
            <Button size="sm" onClick={() => navigate('edit')}>
              {t('common.edit')}
            </Button>
          </Can>
        }
      />
      <Card>
        <CardHeader title={t('organization.detail.identity')} />
        <CardBody>
          <dl className="space-y-3 text-sm">
            <Row label={t('organization.field.code')}>
              <span className="font-mono text-xs" dir="ltr">
                {cc.code}
              </span>
            </Row>
            <Row label={`${t('organization.field.name')} (${t('organization.lang.ar')})`}>
              {cc.name.ar}
            </Row>
            <Row label={`${t('organization.field.name')} (${t('organization.lang.en')})`}>
              {cc.name.en}
            </Row>
            <Row label={t('organization.costCenter.description')}>
              {cc.description === null ? dash : localized(cc.description, locale)}
            </Row>
            <Row label={t('organization.field.status')}>
              <StatusBadge
                tone={cc.status === 'active' ? 'success' : 'neutral'}
                label={t(`organization.status.${cc.status}`)}
              />
            </Row>
          </dl>
        </CardBody>
      </Card>
    </PageContainer>
  );
};
