// Job Position create & edit. Department is required and set only at creation (immutable thereafter —
// shown read-only on edit); Section is optional and must belong to the owning department (the picker
// is scoped to that department). Name is required bilingual; Description is optional bilingual. Edits
// are version-checked; a stale save surfaces as a toast.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type CreateJobPosition, type JobPositionDto, type Locale, type UpdateJobPosition } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Field, Form, FormActions, Select } from '../../../../shared/ui/form';
import { Button } from '../../../../shared/ui/Button';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../shared/lib/api-client';
import { localized } from '../../../../shared/lib/format';
import { LocalizedNameFields, StatusSelect, localizedOrNull, type LocalizedValue } from '../../shared/form-fields';
import { useDepartmentOptions, useSectionOptions } from '../../shared/references';
import { useCreateJobPosition, useJobPosition, useUpdateJobPosition } from '../job-position-queries';

const ROUTE_BASE = '/organization/job-positions';

const JobPositionFormBody = ({ existing }: { existing: JobPositionDto | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const isCreate = existing === null;

  const create = useCreateJobPosition();
  const update = useUpdateJobPosition(existing?.id ?? '');

  const [name, setName] = useState<LocalizedValue>({ ar: existing?.name.ar ?? '', en: existing?.name.en ?? '' });
  const [departmentId, setDepartmentId] = useState<string>(existing?.departmentId ?? '');
  const [sectionId, setSectionId] = useState<string>(existing?.sectionId ?? '');
  const [description, setDescription] = useState<LocalizedValue>({
    ar: existing?.description?.ar ?? '',
    en: existing?.description?.en ?? '',
  });
  const [status, setStatus] = useState<'active' | 'inactive'>(existing?.status ?? 'active');

  const { data: departments = [] } = useDepartmentOptions(undefined, isCreate);
  // Sections are always scoped to the owning department (create: the picked one; edit: the fixed one).
  const scopedDepartmentId = isCreate ? departmentId : existing.departmentId;
  const { data: sections = [] } = useSectionOptions(
    scopedDepartmentId === '' ? undefined : scopedDepartmentId,
    scopedDepartmentId !== '',
  );

  const submit = async (): Promise<void> => {
    if (name.ar.trim() === '' || name.en.trim() === '') {
      toast.error(t('organization.form.nameRequired'));
      return;
    }
    if (isCreate && departmentId === '') {
      toast.error(t('organization.form.departmentRequired'));
      return;
    }
    try {
      if (isCreate) {
        const body: CreateJobPosition = {
          name: { ar: name.ar.trim(), en: name.en.trim() },
          departmentId,
        };
        if (sectionId !== '') body.sectionId = sectionId;
        const desc = localizedOrNull(description);
        if (desc !== null) body.description = desc;
        const doc = await create.mutateAsync(body);
        toast.success(t('organization.jobPosition.created'));
        navigate(`${ROUTE_BASE}/${doc.id}`);
      } else {
        const body: UpdateJobPosition = {
          version: existing.version,
          name: { ar: name.ar.trim(), en: name.en.trim() },
          status,
          sectionId: sectionId === '' ? null : sectionId,
          description: localizedOrNull(description),
        };
        const doc = await update.mutateAsync(body);
        toast.success(t('organization.jobPosition.updated'));
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
    ? t('organization.jobPosition.create')
    : t('organization.form.editTitle', { name: localized(existing.name, locale) });

  return (
    <PageContainer>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.jobPositions'), to: ROUTE_BASE },
          { label: isCreate ? t('organization.form.newCrumb') : localized(existing.name, locale) },
        ]}
      />
      <Card>
        <CardHeader title={t('organization.detail.identity')} />
        <CardBody>
          <Form onSubmit={() => void submit()}>
            <LocalizedNameFields label={t('organization.field.name')} value={name} onChange={setName} required />

            {isCreate ? (
              <Field label={t('organization.field.department')} required>
                <Select
                  value={departmentId}
                  onChange={(e) => {
                    setDepartmentId(e.target.value);
                    setSectionId('');
                  }}
                >
                  <option value="">{t('organization.form.selectDepartment')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {localized(d.name, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label={t('organization.field.department')} hint={t('organization.jobPosition.departmentFixed')}>
                <DepartmentReadonly departmentId={existing.departmentId} />
              </Field>
            )}

            <Field label={t('organization.field.section')} hint={t('organization.jobPosition.sectionHint')}>
              <Select
                value={sectionId}
                disabled={scopedDepartmentId === ''}
                onChange={(e) => setSectionId(e.target.value)}
              >
                <option value="">{t('organization.jobPosition.noSection')}</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {localized(s.name, locale)}
                  </option>
                ))}
              </Select>
            </Field>

            <LocalizedNameFields
              label={t('organization.field.description')}
              value={description}
              onChange={setDescription}
            />

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

/** Read-only display of the (immutable) owning department on the edit form. */
const DepartmentReadonly = ({ departmentId }: { departmentId: string }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: departments = [] } = useDepartmentOptions(undefined);
  const department = departments.find((d) => d.id === departmentId);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
      {department === undefined ? departmentId : localized(department.name, locale)}
    </div>
  );
};

export const JobPositionFormPage = ({ mode }: { mode: 'create' | 'edit' }): JSX.Element => {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = useJobPosition(mode === 'edit' ? id : '');

  if (mode === 'create') return <JobPositionFormBody existing={null} />;
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
  return <JobPositionFormBody existing={data} />;
};
