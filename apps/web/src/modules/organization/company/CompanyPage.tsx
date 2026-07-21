// Company profile: the Organization singleton (ADR-015). Read-only summary with an inline,
// permission-gated edit form (organization.edit). Legal name / tax number / commercial registry
// and the fiscal-year start month are all editable; the save is version-checked.
import { useState } from 'react';
import { type Locale, type UpdateOrganization } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Form, FormActions, Select } from '../../../shared/ui/form';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../shared/lib/api-client';
import { formatDateTime, localized } from '../../../shared/lib/format';
import { LocalizedNameFields, type LocalizedValue } from '../shared/form-fields';
import { useOrganization, useUpdateOrganization } from './company-api';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const CompanyPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: org, isLoading, isError, error, refetch } = useOrganization();
  const update = useUpdateOrganization();
  const [editing, setEditing] = useState(false);

  const [name, setName] = useState<LocalizedValue>({ ar: '', en: '' });
  const [legalName, setLegalName] = useState<LocalizedValue>({ ar: '', en: '' });
  const [taxNumber, setTaxNumber] = useState('');
  const [commercialRegistry, setCommercialRegistry] = useState('');
  const [fiscalMonth, setFiscalMonth] = useState(1);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || org === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const startEdit = (): void => {
    setName({ ar: org.name.ar, en: org.name.en });
    setLegalName({ ar: org.legalName?.ar ?? '', en: org.legalName?.en ?? '' });
    setTaxNumber(org.taxNumber ?? '');
    setCommercialRegistry(org.commercialRegistry ?? '');
    setFiscalMonth(org.fiscalYearStartMonth);
    setEditing(true);
  };

  const submit = async (): Promise<void> => {
    if (name.ar.trim() === '' || name.en.trim() === '') {
      toast.error(t('organization.form.nameRequired'));
      return;
    }
    const body: UpdateOrganization = {
      version: org.version,
      name: { ar: name.ar.trim(), en: name.en.trim() },
      taxNumber: taxNumber.trim() === '' ? null : taxNumber.trim(),
      commercialRegistry: commercialRegistry.trim() === '' ? null : commercialRegistry.trim(),
      fiscalYearStartMonth: fiscalMonth,
    };
    if (legalName.ar.trim() !== '' && legalName.en.trim() !== '') {
      body.legalName = { ar: legalName.ar.trim(), en: legalName.en.trim() };
    }
    try {
      await update.mutateAsync(body);
      toast.success(t('organization.company.updated'));
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      // other errors surface globally
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.company.title')}
        description={t('organization.company.subtitle')}
        breadcrumbs={[{ label: t('organization.title'), to: '/organization' }, { label: t('organization.company.title') }]}
        actions={
          !editing ? (
            <Can permission="organization.edit">
              <Button size="sm" variant="secondary" onClick={startEdit}>
                {t('common.edit')}
              </Button>
            </Can>
          ) : undefined
        }
      />

      {!editing ? (
        <Card>
          <CardHeader title={localized(org.name, locale)} />
          <CardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Row label={`${t('organization.company.name')} (${t('organization.lang.ar')})`}>
                <span dir="rtl">{org.name.ar}</span>
              </Row>
              <Row label={`${t('organization.company.name')} (${t('organization.lang.en')})`}>
                <span dir="ltr">{org.name.en}</span>
              </Row>
              <Row label={t('organization.company.legalName')}>
                {org.legalName === null ? '—' : localized(org.legalName, locale)}
              </Row>
              <Row label={t('organization.company.taxNumber')}>
                <span dir="ltr">{org.taxNumber ?? '—'}</span>
              </Row>
              <Row label={t('organization.company.commercialRegistry')}>
                <span dir="ltr">{org.commercialRegistry ?? '—'}</span>
              </Row>
              <Row label={t('organization.company.fiscalYearStart')}>
                {t(`organization.month.${org.fiscalYearStartMonth}`)}
              </Row>
              <Row label={t('organization.field.updated')}>{formatDateTime(org.updatedAt, locale)}</Row>
            </dl>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title={t('organization.company.editTitle')} />
          <CardBody>
            <Form onSubmit={() => void submit()}>
              <LocalizedNameFields label={t('organization.company.name')} value={name} onChange={setName} required />
              <LocalizedNameFields label={t('organization.company.legalName')} value={legalName} onChange={setLegalName} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('organization.company.taxNumber')}>
                  <Input dir="ltr" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
                </Field>
                <Field label={t('organization.company.commercialRegistry')}>
                  <Input dir="ltr" value={commercialRegistry} onChange={(e) => setCommercialRegistry(e.target.value)} />
                </Field>
              </div>
              <Field label={t('organization.company.fiscalYearStart')}>
                <Select value={fiscalMonth} onChange={(e) => setFiscalMonth(Number(e.target.value))}>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {t(`organization.month.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <FormActions>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" loading={update.isPending}>
                  {t('common.save')}
                </Button>
              </FormActions>
            </Form>
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
};
