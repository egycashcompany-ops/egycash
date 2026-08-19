// Job Title create & edit. Only `jobGrade` (plus code + name) is required; salary band, description,
// qualifications and required experience are optional and can be enriched over time. The salary band
// must be coherent (min ≤ max). Edits are version-checked. Code is immutable after create.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type CreateJobTitle, type JobTitleDto, type Locale, type UpdateJobTitle } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { MoneyInput } from '../../../../shared/ui/MoneyInput';
import { Field, Input, Checkbox, Form, FormActions } from '../../../../shared/ui/form';
import { Button } from '../../../../shared/ui/Button';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../shared/lib/api-client';
import { localized } from '../../../../shared/lib/format';
import { LocalizedNameFields, StatusSelect, localizedOrNull, type LocalizedValue } from '../../shared/form-fields';
import { useCreateJobTitle, useJobTitle, useUpdateJobTitle } from '../job-title-queries';

const numOrNull = (s: string): number | null => {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

const JobTitleFormBody = ({ existing }: { existing: JobTitleDto | null }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const isCreate = existing === null;

  const create = useCreateJobTitle();
  const update = useUpdateJobTitle(existing?.id ?? '');

  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState<LocalizedValue>({ ar: existing?.name.ar ?? '', en: existing?.name.en ?? '' });
  const [jobGrade, setJobGrade] = useState(existing?.jobGrade ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(existing?.status ?? 'active');
  const [description, setDescription] = useState<LocalizedValue>({
    ar: existing?.description?.ar ?? '',
    en: existing?.description?.en ?? '',
  });
  const [qualifications, setQualifications] = useState<LocalizedValue>({
    ar: existing?.requiredQualifications?.ar ?? '',
    en: existing?.requiredQualifications?.en ?? '',
  });
  const [salaryMin, setSalaryMin] = useState(existing?.salaryMin === undefined || existing?.salaryMin === null ? '' : String(existing.salaryMin));
  const [salaryMax, setSalaryMax] = useState(existing?.salaryMax === undefined || existing?.salaryMax === null ? '' : String(existing.salaryMax));
  const [experience, setExperience] = useState(
    existing?.requiredExperienceYears === undefined || existing?.requiredExperienceYears === null
      ? ''
      : String(existing.requiredExperienceYears),
  );
  const [requiresDrivingTest, setRequiresDrivingTest] = useState(existing?.requiresDrivingTest ?? false);
  const [fixedSalary, setFixedSalary] = useState(
    existing?.fixedSalary == null ? '' : String(existing.fixedSalary.amount),
  );

  /**
   * The band warns while you type; it never blocks (P-HR-22 — the owner's ruling).
   *
   * Computed here rather than read from `fixedSalaryOutsideBand` on the DTO so the warning tracks
   * the form's unsaved state — the server's answer describes what is stored, which is the wrong
   * thing to show somebody who is mid-edit. The two agree once the page is saved.
   */
  const outsideBand = ((): boolean => {
    const fixed = numOrNull(fixedSalary);
    if (fixed === null) return false;
    const min = numOrNull(salaryMin);
    const max = numOrNull(salaryMax);
    return (min !== null && fixed < min) || (max !== null && fixed > max);
  })();

  const submit = async (): Promise<void> => {
    if (name.ar.trim() === '' || name.en.trim() === '') {
      toast.error(t('organization.form.nameRequired'));
      return;
    }
    if (isCreate && code.trim() === '') {
      toast.error(t('organization.form.codeRequired'));
      return;
    }
    if (jobGrade.trim() === '') {
      toast.error(t('organization.jobTitle.gradeRequired'));
      return;
    }
    const min = numOrNull(salaryMin);
    const max = numOrNull(salaryMax);
    if (min !== null && max !== null && min > max) {
      toast.error(t('organization.jobTitle.salaryOrder'));
      return;
    }
    // The band advises; it does not gate. A fixed salary outside it saves and warns (P-HR-22).
    const fixed = numOrNull(fixedSalary);
    const fixedMoney = fixed === null ? null : { amount: fixed, currency: 'EGP' };

    try {
      if (isCreate) {
        const body: CreateJobTitle = {
          code: code.trim().toUpperCase(),
          name: { ar: name.ar.trim(), en: name.en.trim() },
          jobGrade: jobGrade.trim(),
        };
        const desc = localizedOrNull(description);
        const qual = localizedOrNull(qualifications);
        if (desc !== null) body.description = desc;
        if (qual !== null) body.requiredQualifications = qual;
        if (min !== null) body.salaryMin = min;
        if (max !== null) body.salaryMax = max;
        if (experience.trim() !== '') body.requiredExperienceYears = numOrNull(experience) ?? undefined;
        if (requiresDrivingTest) body.requiresDrivingTest = true;
        if (fixedMoney !== null) body.fixedSalary = fixedMoney;
        const doc = await create.mutateAsync(body);
        toast.success(t('organization.jobTitle.created'));
        navigate(`/organization/job-titles/${doc.id}`);
      } else {
        const body: UpdateJobTitle = {
          version: existing.version,
          name: { ar: name.ar.trim(), en: name.en.trim() },
          jobGrade: jobGrade.trim(),
          status,
          description: localizedOrNull(description),
          requiredQualifications: localizedOrNull(qualifications),
          salaryMin: min,
          salaryMax: max,
          requiredExperienceYears: numOrNull(experience),
          requiresDrivingTest,
          fixedSalary: fixedMoney,
        };
        const doc = await update.mutateAsync(body);
        toast.success(t('organization.jobTitle.updated'));
        navigate(`/organization/job-titles/${doc.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      else if (e instanceof ApiError && e.code === 'DUPLICATE') toast.error(t('organization.form.duplicateCode'));
      // other errors surface globally
    }
  };

  const title = isCreate
    ? t('organization.jobTitle.create')
    : t('organization.form.editTitle', { name: localized(existing.name, locale) });

  return (
    <PageContainer>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.jobTitles'), to: '/organization/job-titles' },
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
                  placeholder="JT-CASH-OFFICER"
                />
              </Field>
            )}
            <LocalizedNameFields label={t('organization.field.name')} value={name} onChange={setName} required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('organization.jobTitle.grade')} required>
                <Input value={jobGrade} onChange={(e) => setJobGrade(e.target.value)} placeholder="G5" />
              </Field>
              {!isCreate && <StatusSelect value={status} onChange={setStatus} />}
            </div>
            <LocalizedNameFields
              label={t('organization.jobTitle.description')}
              value={description}
              onChange={setDescription}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('organization.jobTitle.requirements')}
            description={t('organization.jobTitle.requirementsHint')}
          />
          <CardBody className="space-y-4">
            <Field
              label={t('organization.jobTitle.fixedSalary')}
              hint={t('organization.jobTitle.fixedSalaryHint')}
            >
              <MoneyInput value={fixedSalary} onChange={setFixedSalary} />
            </Field>
            {outsideBand ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {t('organization.jobTitle.fixedSalaryOutsideBand')}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('organization.jobTitle.salaryMin')} hint="EGP">
                <MoneyInput value={salaryMin} onChange={(next) => setSalaryMin(next)} />
              </Field>
              <Field label={t('organization.jobTitle.salaryMax')} hint="EGP">
                <MoneyInput value={salaryMax} onChange={(next) => setSalaryMax(next)} />
              </Field>
              <Field label={t('organization.jobTitle.experience')}>
                <MoneyInput value={experience} onChange={(next) => setExperience(next)} />
              </Field>
            </div>
            {/* The single place driver-ness is decided. Recruitment reads this flag, so a role
                that needs a driving test says so here rather than being recognised by its name. */}
            <Checkbox
              checked={requiresDrivingTest}
              onChange={(e) => setRequiresDrivingTest(e.target.checked)}
              label={t('organization.jobTitle.requiresDrivingTest')}
            />
            <LocalizedNameFields
              label={t('organization.jobTitle.qualifications')}
              value={qualifications}
              onChange={setQualifications}
            />
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

export const JobTitleFormPage = ({ mode }: { mode: 'create' | 'edit' }): JSX.Element => {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = useJobTitle(mode === 'edit' ? id : '');

  if (mode === 'create') return <JobTitleFormBody existing={null} />;
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
  return <JobTitleFormBody existing={data} />;
};
