// Application Category create & edit. Name is required bilingual; icon is optional; sort order is a
// non-negative integer (defaults to 0). Edits are version-checked.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  type ApplicationCategoryDto,
  type CreateApplicationCategory,
  type Locale,
  type UpdateApplicationCategory,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Field, Input, Form, FormActions } from '../../../../shared/ui/form';
import { Button } from '../../../../shared/ui/Button';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../shared/lib/api-client';
import { localized } from '../../../../shared/lib/format';
import { LocalizedNameFields, StatusSelect, type LocalizedValue } from '../../shared/form-fields';
import {
  useApplicationCategory,
  useCreateApplicationCategory,
  useUpdateApplicationCategory,
} from '../application-category-queries';

const ROUTE_BASE = '/organization/application-categories';

const CategoryFormBody = ({ existing }: { existing: ApplicationCategoryDto | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const isCreate = existing === null;

  const create = useCreateApplicationCategory();
  const update = useUpdateApplicationCategory(existing?.id ?? '');

  const [name, setName] = useState<LocalizedValue>({ ar: existing?.name.ar ?? '', en: existing?.name.en ?? '' });
  const [icon, setIcon] = useState(existing?.icon ?? '');
  const [sortOrder, setSortOrder] = useState(String(existing?.sortOrder ?? 0));
  const [status, setStatus] = useState<'active' | 'inactive'>(existing?.status ?? 'active');

  const submit = async (): Promise<void> => {
    if (name.ar.trim() === '' || name.en.trim() === '') {
      toast.error(t('organization.form.nameRequired'));
      return;
    }
    const order = Number.parseInt(sortOrder, 10);
    if (Number.isNaN(order) || order < 0) {
      toast.error(t('organization.application.sortOrderInvalid'));
      return;
    }
    const trimmedIcon = icon.trim();
    try {
      if (isCreate) {
        const body: CreateApplicationCategory = {
          name: { ar: name.ar.trim(), en: name.en.trim() },
          sortOrder: order,
        };
        if (trimmedIcon !== '') body.icon = trimmedIcon;
        const doc = await create.mutateAsync(body);
        toast.success(t('organization.applicationCategory.created'));
        navigate(`${ROUTE_BASE}/${doc.id}`);
      } else {
        const body: UpdateApplicationCategory = {
          version: existing.version,
          name: { ar: name.ar.trim(), en: name.en.trim() },
          icon: trimmedIcon === '' ? null : trimmedIcon,
          sortOrder: order,
          status,
        };
        const doc = await update.mutateAsync(body);
        toast.success(t('organization.applicationCategory.updated'));
        navigate(`${ROUTE_BASE}/${doc.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') {
        toast.error(t('organization.form.stale'));
      }
      // other errors surface globally
    }
  };

  const submitting = create.isPending || update.isPending;
  const title = isCreate
    ? t('organization.applicationCategory.create')
    : t('organization.form.editTitle', { name: localized(existing.name, locale) });

  return (
    <PageContainer>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.applicationCategories'), to: ROUTE_BASE },
          { label: isCreate ? t('organization.form.newCrumb') : localized(existing.name, locale) },
        ]}
      />
      <Card>
        <CardHeader title={t('organization.detail.identity')} />
        <CardBody>
          <Form onSubmit={() => void submit()}>
            <LocalizedNameFields label={t('organization.field.name')} value={name} onChange={setName} required />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('organization.application.icon')} hint={t('organization.application.iconHint')}>
                <Input dir="ltr" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="users" />
              </Field>
              <Field label={t('organization.application.sortOrder')} hint={t('organization.application.sortOrderHint')}>
                <Input dir="ltr" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
              </Field>
            </div>

            {!isCreate && <StatusSelect value={status} onChange={setStatus} />}

            <FormActions>
              <Button variant="ghost" onClick={() => navigate(-1)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={submitting}>
                {isCreate ? t('common.create') : t('common.save')}
              </Button>
            </FormActions>
          </Form>
        </CardBody>
      </Card>
    </PageContainer>
  );
};

export const ApplicationCategoryFormPage = ({ mode }: { mode: 'create' | 'edit' }): JSX.Element => {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = useApplicationCategory(mode === 'edit' ? id : '');

  if (mode === 'create') return <CategoryFormBody existing={null} />;
  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || data === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }
  return <CategoryFormBody existing={data} />;
};
