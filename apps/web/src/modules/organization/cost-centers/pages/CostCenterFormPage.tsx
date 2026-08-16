// Cost Centre create & edit — identity only.
//
// No parent picker (D-CC-4: no hierarchy in this phase) and no membership (D-CC-1: membership is a
// dated fact on the employee's own file). A screen offering either would promise something this
// phase deliberately did not decide.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type CostCenterDto, type CreateCostCenter, type Locale, type UpdateCostCenter } from '@ecms/contracts';
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
import {
  LocalizedNameFields,
  StatusSelect,
  localizedOrNull,
  type LocalizedValue,
} from '../../shared/form-fields';
import { useCostCenter, useCreateCostCenter, useUpdateCostCenter } from '../cost-center-queries';

const CostCenterFormBody = ({ existing }: { existing: CostCenterDto | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const isCreate = existing === null;

  const create = useCreateCostCenter();
  const update = useUpdateCostCenter(existing?.id ?? '');

  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState<LocalizedValue>({
    ar: existing?.name.ar ?? '',
    en: existing?.name.en ?? '',
  });
  const [description, setDescription] = useState<LocalizedValue>({
    ar: existing?.description?.ar ?? '',
    en: existing?.description?.en ?? '',
  });
  const [status, setStatus] = useState<'active' | 'inactive'>(existing?.status ?? 'active');

  const submit = async (): Promise<void> => {
    if (name.ar.trim() === '' || name.en.trim() === '') {
      toast.error(t('organization.form.nameRequired'));
      return;
    }
    if (isCreate && code.trim() === '') {
      toast.error(t('organization.form.codeRequired'));
      return;
    }
    try {
      if (isCreate) {
        const body: CreateCostCenter = {
          code: code.trim().toUpperCase(),
          name: { ar: name.ar.trim(), en: name.en.trim() },
        };
        const desc = localizedOrNull(description);
        if (desc !== null) body.description = desc;
        const doc = await create.mutateAsync(body);
        toast.success(t('organization.costCenter.created'));
        navigate(`/organization/cost-centers/${doc.id}`);
      } else {
        const body: UpdateCostCenter = {
          version: existing.version,
          name: { ar: name.ar.trim(), en: name.en.trim() },
          description: localizedOrNull(description),
          status,
        };
        const doc = await update.mutateAsync(body);
        toast.success(t('organization.costCenter.updated'));
        navigate(`/organization/cost-centers/${doc.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      else if (e instanceof ApiError && e.code === 'DUPLICATE') toast.error(t('organization.form.duplicateCode'));
      // other errors surface globally
    }
  };

  const title = isCreate
    ? t('organization.costCenter.create')
    : t('organization.form.editTitle', { name: localized(existing.name, locale) });

  return (
    <PageContainer>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.costCenters'), to: '/organization/cost-centers' },
          { label: isCreate ? t('organization.form.newCrumb') : existing.code },
        ]}
      />

      <Form onSubmit={() => void submit()}>
        <Card>
          <CardHeader title={t('organization.detail.identity')} />
          <CardBody className="space-y-4">
            {isCreate && (
              <Field label={t('organization.field.code')} required hint={t('organization.form.codeHint')}>
                <Input
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CC-OPS"
                />
              </Field>
            )}
            <LocalizedNameFields label={t('organization.field.name')} value={name} onChange={setName} required />
            <LocalizedNameFields
              label={t('organization.costCenter.description')}
              value={description}
              onChange={setDescription}
            />
            {!isCreate && <StatusSelect value={status} onChange={setStatus} />}
          </CardBody>
        </Card>

        <FormActions>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending || update.isPending}>
            {isCreate ? t('common.create') : t('common.save')}
          </Button>
        </FormActions>
      </Form>
    </PageContainer>
  );
};

export const CostCenterFormPage = ({ mode }: { mode: 'create' | 'edit' }): JSX.Element => {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = useCostCenter(mode === 'edit' ? id : '');

  if (mode === 'create') return <CostCenterFormBody existing={null} />;
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
  return <CostCenterFormBody existing={data} />;
};
