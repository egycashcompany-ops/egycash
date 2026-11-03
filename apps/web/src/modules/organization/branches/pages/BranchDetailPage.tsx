// Branch detail (Phase 3.1). Shows the branch identity (Code, ar/en name, manager, status), address
// and audit timestamps, plus the branch actions: Edit, Activate/Deactivate (version-checked),
// Delete (soft, guarded server-side against branches that still have departments) and — behind its
// own key, `branch.changeCode` (ADR-017, amended 2026-11-03) — the Branch-Code correction dialog.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../shared/lib/api-client';
import { formatDateTime, localized } from '../../../../shared/lib/format';
import { UserName } from '../../shared/UserPicker';
import { branchConfig } from '../../shared/unit-config';
import { ChangeBranchCodeDialog } from '../components/ChangeBranchCodeDialog';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const BranchDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();

  const { data: branch, isLoading, isError, error, refetch } = branchConfig.queries.useOne(id);
  const update = branchConfig.queries.useUpdate(id);
  const remove = branchConfig.queries.useRemove();

  const [confirming, setConfirming] = useState(false);
  const [codeDialog, setCodeDialog] = useState(false);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || branch === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const nextStatus = branch.status === 'active' ? 'inactive' : 'active';

  const toggleStatus = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: nextStatus, version: branch.version });
      toast.success(t(`organization.branch.${nextStatus === 'active' ? 'activated' : 'deactivated'}`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      // other errors surface globally
    }
  };

  const doDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(branch.id);
      toast.success(t('organization.branch.deleted'));
      navigate(branchConfig.routeBase);
    } catch (e) {
      setConfirming(false);
      if (e instanceof ApiError && e.code === 'ORG_UNIT_HAS_CHILDREN') {
        toast.error(t('organization.delete.hasChildren'));
      } else {
        toast.error(t('organization.delete.failed'));
      }
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={localized(branch.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.branches'), to: branchConfig.routeBase },
          { label: branch.code },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can permission="branch.edit">
              <Button
                size="sm"
                variant={branch.status === 'active' ? 'ghost' : 'secondary'}
                loading={update.isPending}
                onClick={() => void toggleStatus()}
              >
                {t(branch.status === 'active' ? 'organization.action.deactivate' : 'organization.action.activate')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigate('edit')}>
                {t('common.edit')}
              </Button>
            </Can>
            <Can permission="branch.delete">
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-slate-500" dir="ltr">
          {branch.code}
        </span>
        <StatusBadge
          tone={branch.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${branch.status}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('organization.detail.identity')}
            actions={
              // Its own key: the code heads every employee code the branch issues (ADR-017).
              <Can permission="branch.changeCode">
                <Button size="sm" variant="ghost" onClick={() => setCodeDialog(true)}>
                  {t('organization.branch.changeCode')}
                </Button>
              </Can>
            }
          />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.field.code')}>
                <span className="font-mono" dir="ltr">
                  {branch.code}
                </span>
              </Row>
              <Row label={t('organization.branch.nameAr')}>
                <span dir="rtl">{branch.name.ar}</span>
              </Row>
              <Row label={t('organization.branch.nameEn')}>
                <span dir="ltr">{branch.name.en}</span>
              </Row>
              <Row label={t('organization.field.manager')}>
                <UserName userId={branch.managerId} />
              </Row>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('organization.detail.placement')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              {branch.address != null && (
                <Row label={t('organization.field.address')}>
                  <span>
                    {[
                      branch.address.line1,
                      branch.address.line2,
                      branch.address.city,
                      branch.address.governorate,
                      branch.address.postalCode,
                    ]
                      .filter((p) => p !== undefined && p !== '')
                      .join('، ')}
                  </span>
                </Row>
              )}
              <Row label={t('organization.field.created')}>{formatDateTime(branch.createdAt, locale)}</Row>
              <Row label={t('organization.field.updated')}>{formatDateTime(branch.updatedAt, locale)}</Row>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('organization.branch.deleteTitle')}
        description={t('organization.delete.confirm', { name: localized(branch.name, locale) })}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => void doDelete()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('organization.delete.body')}</p>
      </Dialog>

      {codeDialog && <ChangeBranchCodeDialog branch={branch} onClose={() => setCodeDialog(false)} />}
    </PageContainer>
  );
};
