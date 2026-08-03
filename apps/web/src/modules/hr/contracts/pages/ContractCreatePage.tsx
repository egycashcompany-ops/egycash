// Two-pane contract creation (frozen design §4): left = employee + template + dates +
// per-variable overrides; right = the LIVE server preview (debounced POST /preview into
// an A4-ish iframe — the same renderer that will freeze the snapshot, A18). Generation
// pins the template key's PUBLISHED version (A17), so the picker offers published keys
// and the preview renders that exact version. Missing required variables surface as the
// A16 validation report — generation stays blocked until they are resolved.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type ContractTemplateDto, type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, Card, CardBody, CardHeader, SearchInput, toast } from '../../../../shared/ui';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { localized } from '../../../../shared/lib/format';
import { ApiError } from '../../../../shared/lib/api-client';
import { toOverridePairs } from '../api/contract-api';
import { listEmployees, getEmployee } from '../../employee-management/employees/api/employee-api';
import {
  useContractTemplate,
  useContractTemplates,
  useContractTypes,
  useContractVariables,
  useCreateContract,
  useGenerateContract,
  usePreviewContract,
} from '../api/contract-queries';

const today = (): string => new Date().toISOString().slice(0, 10);

const EmployeePicker = ({
  value,
  onChange,
  locked,
}: {
  value: EmployeeDto | null;
  onChange: (employee: EmployeeDto | null) => void;
  locked: boolean;
}): JSX.Element => {
  const t = useT();
  const [search, setSearch] = useState('');
  const { data } = useQuery({
    queryKey: ['hr', 'contracts', 'employeeSearch', search],
    queryFn: () => listEmployees({ search, pageSize: 20 }),
    enabled: !locked && search.trim() !== '',
  });

  if (value !== null) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600">
        <span>
          {value.personal.fullNameAr}
          <span className="ms-2 font-mono text-xs text-slate-400" dir="ltr">{value.code}</span>
        </span>
        {!locked && (
          <button
            type="button"
            className="text-xs text-brand-600 hover:underline"
            onClick={() => onChange(null)}
          >
            {t('common.change')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SearchInput value={search} onChange={setSearch} placeholder={t('contracts.create.employeeSearch')} />
      {search.trim() !== '' && (
        <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          {(data?.items ?? []).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onChange(e)}
                className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-brand-50 dark:hover:bg-slate-800"
              >
                <span>{e.personal.fullNameAr}</span>
                <span className="font-mono text-xs text-slate-400" dir="ltr">{e.code}</span>
              </button>
            </li>
          ))}
          {data !== undefined && data.items.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-400">{t('contracts.create.noEmployees')}</li>
          )}
        </ul>
      )}
    </div>
  );
};

export const ContractCreatePage = (): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp] = useSearchParams();
  const presetEmployeeId = sp.get('employeeId') ?? '';

  const { data: types } = useContractTypes();
  const { data: templates } = useContractTemplates();
  const { data: catalog } = useContractVariables();

  const [employee, setEmployee] = useState<EmployeeDto | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Preselection from the employee profile (frozen design §4).
  useEffect(() => {
    if (presetEmployeeId === '' || employee !== null) return;
    getEmployee(presetEmployeeId)
      .then(setEmployee)
      .catch(() => toast.error(t('contracts.create.employeeLoadFailed')));
  }, [presetEmployeeId]);

  // Only keys with a PUBLISHED version can generate (A17).
  const publishable = useMemo(
    () =>
      (templates ?? []).filter(
        (x): x is ContractTemplateDto & { publishedTemplateId: string } =>
          typeof x.publishedTemplateId === 'string' &&
          (typeFilter === '' || x.contractTypeId === typeFilter),
      ),
    [templates, typeFilter],
  );
  const chosen = publishable.find((x) => x.key === templateKey) ?? null;
  // The PUBLISHED version drives placeholders, previews and the create body.
  const { data: published } = useContractTemplate(chosen?.publishedTemplateId ?? '');
  const chosenType = (types ?? []).find((x) => x.id === published?.contractTypeId) ?? null;

  const preview = usePreviewContract();
  const create = useCreateContract();
  const generate = useGenerateContract();

  // Debounced live preview (A18) — rendered by the server, shown in an A4-ish frame.
  const [previewHtml, setPreviewHtml] = useState('');
  const previewSeq = useRef(0);
  useEffect(() => {
    if (employee === null || published === undefined) {
      setPreviewHtml('');
      return;
    }
    const seq = ++previewSeq.current;
    const id = window.setTimeout(() => {
      preview
        .mutateAsync({
          employeeId: employee.id,
          templateId: published.id,
          startDate,
          endDate: endDate === '' ? null : endDate,
          overrides: toOverridePairs(overrides),
        })
        .then((result) => {
          if (previewSeq.current === seq) setPreviewHtml(result.html);
        })
        .catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(id);
  }, [employee?.id, published?.id, startDate, endDate, JSON.stringify(overrides)]);

  const issues = preview.data?.issues ?? [];
  const canSubmit = employee !== null && published !== undefined && startDate !== '';

  const submit = async (andGenerate: boolean): Promise<void> => {
    // A published template always carries a type (the publish gate enforces it) —
    // the null check only narrows the DTO type for still-authoring drafts.
    const typeId = published?.contractTypeId ?? null;
    if (employee === null || published === undefined || typeId === null) return;
    try {
      const draft = await create.mutateAsync({
        employeeId: employee.id,
        typeId,
        templateId: published.id,
        startDate,
        endDate: endDate === '' || chosenType?.allowsEndDate === false ? null : endDate,
        referenceNumber: referenceNumber.trim() === '' ? null : referenceNumber.trim(),
        overrides: toOverridePairs(overrides),
      });
      if (andGenerate) {
        try {
          await generate.mutateAsync({ id: draft.id, version: draft.version });
          toast.success(t('contracts.create.generated'));
        } catch (error) {
          const message =
            error instanceof ApiError && error.code === 'CONTRACT_VARIABLES_MISSING'
              ? t('contracts.create.missingVariables')
              : t('contracts.create.generateBlocked');
          toast.info(message);
        }
      } else {
        toast.success(t('contracts.create.saved'));
      }
      navigate(`/contracts/${draft.id}`);
    } catch {
      // surfaced globally
    }
  };

  const labelOf = (key: string): string => {
    const entry = (catalog ?? []).find((v) => v.key === key);
    return entry === undefined ? key : `${entry.label[locale]}${entry.required ? ' *' : ''}`;
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('contracts.create.title')}
        description={t('contracts.create.subtitle')}
        breadcrumbs={[{ label: t('contracts.module.title'), to: '/contracts' }, { label: t('contracts.create.title') }]}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('contracts.create.details')} />
            <CardBody>
              <div className="space-y-4">
                <Field label={t('contracts.columns.employee')} required>
                  <EmployeePicker value={employee} onChange={setEmployee} locked={presetEmployeeId !== ''} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t('contracts.columns.type')}>
                    <Select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setTemplateKey(''); }}>
                      <option value="">{t('contracts.filters.allTypes')}</option>
                      {(types ?? []).filter((x) => x.status === 'active').map((x) => (
                        <option key={x.id} value={x.id}>{localized(x.name, locale)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('contracts.create.template')} required>
                    <Select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                      <option value="">{t('contracts.create.templatePick')}</option>
                      {publishable.map((x) => (
                        <option key={x.key} value={x.key}>
                          {localized(x.name, locale)} ({x.language === 'ar' ? t('contracts.language.ar') : t('contracts.language.en')})
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t('contracts.fields.startDate')} required>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </Field>
                  {chosenType?.allowsEndDate !== false && (
                    <Field label={t('contracts.fields.endDate')}>
                      <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </Field>
                  )}
                </div>
                <Field label={t('contracts.fields.referenceNumber')} hint={t('contracts.fields.referenceHint')}>
                  <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
                </Field>
              </div>
            </CardBody>
          </Card>

          {published !== undefined && published.placeholders.length > 0 && (
            <Card>
              <CardHeader
                title={t('contracts.create.overrides')}
                description={t('contracts.create.overridesHint')}
              />
              <CardBody>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {published.placeholders.map((key) => (
                    <Field key={key} label={labelOf(key)}>
                      <Input
                        value={overrides[key] ?? ''}
                        placeholder={t('contracts.create.autoResolved')}
                        onChange={(e) => {
                          const next = { ...overrides };
                          if (e.target.value === '') delete next[key];
                          else next[key] = e.target.value;
                          setOverrides(next);
                        }}
                      />
                    </Field>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate('/contracts')}>{t('common.cancel')}</Button>
            <Button
              variant="secondary"
              disabled={!canSubmit}
              loading={create.isPending}
              onClick={() => void submit(false)}
            >
              {t('contracts.create.saveDraft')}
            </Button>
            <Button
              disabled={!canSubmit || issues.length > 0}
              loading={create.isPending || generate.isPending}
              onClick={() => void submit(true)}
            >
              {t('contracts.create.saveGenerate')}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {issues.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">{t('contracts.create.issuesTitle')}</p>
              <ul className="mt-1 list-disc ps-5">
                {issues.map((issue) => (
                  <li key={issue.placeholder}>
                    <code dir="ltr">{issue.placeholder}</code> — {issue.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Card>
            <CardHeader title={t('contracts.create.preview')} description={t('contracts.create.previewHint')} />
            <CardBody>
              {previewHtml === '' ? (
                <div className="grid min-h-96 place-items-center text-sm text-slate-400">
                  {t('contracts.create.previewEmpty')}
                </div>
              ) : (
                <iframe
                  title={t('contracts.create.preview')}
                  sandbox=""
                  srcDoc={previewHtml}
                  className="h-[70vh] w-full rounded border border-slate-200 bg-white dark:border-slate-700"
                />
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
};
