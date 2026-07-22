// Application Category detail: identity (ar/en name, icon), sort order, status, timestamps, plus
// Edit / Activate-Deactivate / soft Delete. Delete is guarded server-side while applications still
// reference the category (surfaced as a toast).
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
import {
  useApplicationCategory,
  useDeleteApplicationCategory,
  useUpdateApplicationCategory,
} from '../application-category-queries';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const ApplicationCategoryDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();

  const { data: category, isLoading, isError, error, refetch } = useApplicationCategory(id);
  const update = useUpdateApplicationCategory(id);
  const remove = useDeleteApplicationCategory();

  const [confirming, setConfirming] = useState(false);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || category === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const nextStatus = category.status === 'active' ? 'inactive' : 'active';

  const toggleStatus = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: nextStatus, version: category.version });
      toast.success(t(`organization.applicationCategory.${nextStatus === 'active' ? 'activated' : 'deactivated'}`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      // other errors surface globally
    }
  };

  const doDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(category.id);
      toast.success(t('organization.applicationCategory.deleted'));
      navigate('/organization/application-categories');
    } catch (e) {
      setConfirming(false);
      if (e instanceof ApiError && e.code === 'APPLICATION_CATEGORY_IN_USE') {
        toast.error(t('organization.applicationCategory.inUse'));
      } else {
        toast.error(t('organization.delete.failed'));
      }
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={localized(category.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.applicationCategories'), to: '/organization/application-categories' },
          { label: localized(category.name, locale) },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can permission="applicationCategory.edit">
              <Button
                size="sm"
                variant={category.status === 'active' ? 'ghost' : 'secondary'}
                loading={update.isPending}
                onClick={() => void toggleStatus()}
              >
                {t(category.status === 'active' ? 'organization.action.deactivate' : 'organization.action.activate')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigate('edit')}>
                {t('common.edit')}
              </Button>
            </Can>
            <Can permission="applicationCategory.delete">
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge tone={category.status === 'active' ? 'success' : 'neutral'} label={t(`organization.status.${category.status}`)} />
      </div>

      <Card>
        <CardHeader title={t('organization.detail.identity')} />
        <CardBody>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Row label={t('organization.applicationCategory.nameAr')}>
              <span dir="rtl">{category.name.ar}</span>
            </Row>
            <Row label={t('organization.applicationCategory.nameEn')}>
              <span dir="ltr">{category.name.en}</span>
            </Row>
            <Row label={t('organization.application.icon')}>
              {category.icon === null ? (
                <span className="text-slate-400">—</span>
              ) : (
                <span className="font-mono text-xs" dir="ltr">
                  {category.icon}
                </span>
              )}
            </Row>
            <Row label={t('organization.application.sortOrder')}>{category.sortOrder}</Row>
            <Row label={t('organization.field.created')}>{formatDateTime(category.createdAt, locale)}</Row>
            <Row label={t('organization.field.updated')}>{formatDateTime(category.updatedAt, locale)}</Row>
          </dl>
        </CardBody>
      </Card>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('organization.applicationCategory.deleteTitle')}
        description={t('organization.delete.confirm', { name: localized(category.name, locale) })}
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
    </PageContainer>
  );
};
