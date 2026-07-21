// Generic Branch/Department/Section create & edit form. Immutable-after-create fields (code, parent
// linkage) are shown only in create mode — mirroring the backend update schemas, which omit them.
// Edits are version-checked (optimistic concurrency); a stale save surfaces as a toast. Branches
// additionally carry an optional postal address. The outer page loads the record (edit mode) and
// mounts the body only once data is present, so the form seeds cleanly from it.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Address, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Field, Input, Form, FormActions, Select } from '../../../shared/ui/form';
import { Button } from '../../../shared/ui/Button';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../shared/lib/api-client';
import { localized } from '../../../shared/lib/format';
import { LocalizedNameFields, StatusSelect, type LocalizedValue } from './form-fields';
import { UserPicker } from './UserPicker';
import { useBranchOptions, useDepartmentOptions } from './references';
import { type AnyUnitDto, type UnitBody } from './org-unit-resource';
import { type UnitConfig } from './unit-config';

type AddressForm = { line1: string; line2: string; city: string; governorate: string; postalCode: string };
const emptyAddress: AddressForm = { line1: '', line2: '', city: '', governorate: '', postalCode: '' };

const toAddressForm = (a: Address | null | undefined): AddressForm =>
  a == null
    ? { ...emptyAddress }
    : {
        line1: a.line1,
        line2: a.line2 ?? '',
        city: a.city,
        governorate: a.governorate,
        postalCode: a.postalCode ?? '',
      };

const UnitFormBody = <TDto extends AnyUnitDto>({
  config,
  existing,
}: {
  config: UnitConfig<TDto>;
  existing: TDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const isCreate = existing === null;

  const create = config.queries.useCreate();
  const update = config.queries.useUpdate(existing?.id ?? '');

  const wantsBranch = config.parents.includes('branch');
  const wantsDept = config.parents.includes('department');

  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState<LocalizedValue>({ ar: existing?.name.ar ?? '', en: existing?.name.en ?? '' });
  const [status, setStatus] = useState<'active' | 'inactive'>(existing?.status ?? 'active');
  const [managerId, setManagerId] = useState<string | null>(existing?.managerId ?? null);
  const [branchId, setBranchId] = useState<string>(existing?.branchId ?? '');
  const [departmentId, setDepartmentId] = useState<string>(existing?.departmentId ?? '');
  const [address, setAddress] = useState<AddressForm>(toAddressForm(existing?.address));

  const { data: branches = [] } = useBranchOptions(wantsBranch && isCreate);
  const { data: departments = [] } = useDepartmentOptions(
    branchId === '' ? undefined : branchId,
    wantsDept && isCreate,
  );

  const buildAddress = (): Address | null | 'invalid' => {
    if (!config.hasAddress) return null;
    const filled = Object.values(address).some((v) => v.trim() !== '');
    if (!filled) return null;
    if (address.line1.trim() === '' || address.city.trim() === '' || address.governorate.trim() === '') {
      return 'invalid';
    }
    const built: Address = {
      line1: address.line1.trim(),
      city: address.city.trim(),
      governorate: address.governorate.trim(),
    };
    if (address.line2.trim() !== '') built.line2 = address.line2.trim();
    if (address.postalCode.trim() !== '') built.postalCode = address.postalCode.trim();
    return built;
  };

  const submit = async (): Promise<void> => {
    if (name.ar.trim() === '' || name.en.trim() === '') {
      toast.error(t('organization.form.nameRequired'));
      return;
    }
    if (isCreate && code.trim() === '') {
      toast.error(t('organization.form.codeRequired'));
      return;
    }
    if (isCreate && wantsBranch && branchId === '') {
      toast.error(t('organization.form.branchRequired'));
      return;
    }
    if (isCreate && wantsDept && departmentId === '') {
      toast.error(t('organization.form.departmentRequired'));
      return;
    }
    const addr = buildAddress();
    if (addr === 'invalid') {
      toast.error(t('organization.form.addressIncomplete'));
      return;
    }

    try {
      if (isCreate) {
        const body: UnitBody = {
          code: code.trim().toUpperCase(),
          name: { ar: name.ar.trim(), en: name.en.trim() },
          managerId,
        };
        if (wantsBranch) body.branchId = branchId;
        if (wantsDept) body.departmentId = departmentId;
        if (config.hasAddress && addr !== null) body.address = addr;
        const doc = await create.mutateAsync(body);
        toast.success(t(`organization.${config.entity}.created`));
        navigate(`${config.routeBase}/${doc.id}`);
      } else {
        const body: UnitBody = {
          version: existing.version,
          name: { ar: name.ar.trim(), en: name.en.trim() },
          status,
          managerId,
        };
        if (config.hasAddress && addr !== null) body.address = addr;
        const doc = await update.mutateAsync(body);
        toast.success(t(`organization.${config.entity}.updated`));
        navigate(`${config.routeBase}/${doc.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') {
        toast.error(t('organization.form.stale'));
      } else if (e instanceof ApiError && e.code === 'DUPLICATE') {
        toast.error(t('organization.form.duplicateCode'));
      }
      // other errors surface globally
    }
  };

  const submitting = create.isPending || update.isPending;
  const title = isCreate
    ? t(`organization.${config.entity}.create`)
    : t('organization.form.editTitle', { name: localized(existing.name, locale) });

  return (
    <PageContainer>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t(`organization.nav.${config.feature}`), to: config.routeBase },
          { label: isCreate ? t('organization.form.newCrumb') : existing.code },
        ]}
      />
      <Card>
        <CardHeader title={t('organization.detail.identity')} />
        <CardBody>
          <Form onSubmit={() => void submit()}>
            {isCreate && (
              <Field label={t('organization.field.code')} required hint={t('organization.form.codeHint')}>
                <Input
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="BR-CAI-1"
                />
              </Field>
            )}

            <LocalizedNameFields label={t('organization.field.name')} value={name} onChange={setName} required />

            {isCreate && wantsBranch && (
              <Field label={t('organization.nav.branches')} required>
                <Select
                  value={branchId}
                  onChange={(e) => {
                    setBranchId(e.target.value);
                    setDepartmentId('');
                  }}
                >
                  <option value="">{t('organization.form.selectBranch')}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {localized(b.name, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {isCreate && wantsDept && (
              <Field label={t('organization.nav.departments')} required>
                <Select
                  value={departmentId}
                  disabled={branchId === ''}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">{t('organization.form.selectDepartment')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {localized(d.name, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label={t('organization.field.manager')} hint={t('organization.form.managerHint')}>
              <UserPicker value={managerId} onChange={setManagerId} />
            </Field>

            {!isCreate && <StatusSelect value={status} onChange={setStatus} />}

            {config.hasAddress && (
              <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <legend className="px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('organization.field.address')}
                </legend>
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('organization.address.line1')}>
                      <Input value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} />
                    </Field>
                    <Field label={t('organization.address.line2')}>
                      <Input value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t('organization.address.city')}>
                      <Input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} />
                    </Field>
                    <Field label={t('organization.address.governorate')}>
                      <Input
                        value={address.governorate}
                        onChange={(e) => setAddress({ ...address, governorate: e.target.value })}
                      />
                    </Field>
                    <Field label={t('organization.address.postalCode')}>
                      <Input
                        dir="ltr"
                        value={address.postalCode}
                        onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              </fieldset>
            )}

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

export const UnitFormPage = <TDto extends AnyUnitDto>({
  config,
  mode,
}: {
  config: UnitConfig<TDto>;
  mode: 'create' | 'edit';
}): JSX.Element => {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = config.queries.useOne(mode === 'edit' ? id : '');

  if (mode === 'create') return <UnitFormBody config={config} existing={null} />;
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
  return <UnitFormBody config={config} existing={data} />;
};
