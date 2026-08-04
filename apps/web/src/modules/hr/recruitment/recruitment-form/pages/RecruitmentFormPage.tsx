// The intake form's admin page: what candidates are asked, and the link each source gets.
//
// Reordering is done here, in local state, and saved as one list — the array IS the order, so
// "move up" is not a separate endpoint that can half-succeed.
import { useEffect, useState } from 'react';
import {
  RECRUITMENT_FORM_BUILTINS,
  RECRUITMENT_FORM_INPUT_KINDS,
  RECRUITMENT_FORM_MANDATORY,
  type RecruitmentFormBuiltin,
  type RecruitmentFormField,
  type RecruitmentFormInputKind,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Button } from '../../../../../shared/ui/Button';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Field, Input, Select, Checkbox } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { PlusIcon, TrashIcon } from '../../../../../shared/ui/icons';
import { fieldLabel } from '../components/FormFieldInput';
import {
  useGenerateFormLink,
  useRecruitmentForm,
  useRevokeFormLink,
  useUpdateRecruitmentForm,
} from '../api/recruitment-form-queries';

const isLocked = (field: RecruitmentFormField): boolean =>
  field.type === 'builtin' && RECRUITMENT_FORM_MANDATORY.includes(field.key);

export const RecruitmentFormPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { data: form, isLoading, isError, error, refetch } = useRecruitmentForm();
  const save = useUpdateRecruitmentForm();
  const generate = useGenerateFormLink();
  const revoke = useRevokeFormLink();

  const [fields, setFields] = useState<RecruitmentFormField[]>([]);
  const [internalSourceId, setInternalSourceId] = useState('');
  const [dirty, setDirty] = useState(false);

  // The server's copy is the truth until the page is edited; after that, local state is, so a
  // background refetch cannot silently discard work in progress.
  useEffect(() => {
    if (form === undefined || dirty) return;
    setFields(form.fields);
    setInternalSourceId(form.internalSourceId ?? '');
  }, [form, dirty]);

  if (isLoading) return <PageContainer><LoadingState /></PageContainer>;
  if (isError || form === undefined) {
    return <PageContainer><ErrorState error={error} onRetry={() => void refetch()} /></PageContainer>;
  }

  const edit = (next: RecruitmentFormField[]): void => {
    setFields(next);
    setDirty(true);
  };
  const move = (index: number, by: number): void => {
    const target = index + by;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const [row] = next.splice(index, 1);
    if (row !== undefined) next.splice(target, 0, row);
    edit(next);
  };

  const unusedBuiltins = RECRUITMENT_FORM_BUILTINS.filter(
    (key) => !fields.some((f) => f.type === 'builtin' && f.key === key),
  );

  const addBuiltin = (key: RecruitmentFormBuiltin): void =>
    edit([...fields, { type: 'builtin', key, required: false }]);

  const addCustom = (): void =>
    edit([
      ...fields,
      {
        type: 'custom',
        key: `q${Date.now().toString(36)}`,
        kind: 'text',
        label: { ar: 'سؤال جديد', en: 'New question' },
        required: false,
        options: [],
      },
    ]);

  const patchCustom = (index: number, patch: Partial<Extract<RecruitmentFormField, { type: 'custom' }>>): void =>
    edit(fields.map((f, i) => (i === index && f.type === 'custom' ? { ...f, ...patch } : f)));

  const onSave = (): void => {
    save.mutate(
      {
        fields,
        internalSourceId: internalSourceId === '' ? null : internalSourceId,
        version: form.version,
      },
      {
        onSuccess: () => {
          setDirty(false);
          toast.success(t('recruitmentForm.saved'));
        },
      },
    );
  };

  const copy = (url: string): void => {
    void navigator.clipboard.writeText(url).then(() => toast.success(t('recruitmentForm.copied')));
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitmentForm.title')}
        description={t('recruitmentForm.subtitle')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitmentForm.title') },
        ]}
        actions={
          <Button onClick={onSave} loading={save.isPending} disabled={!dirty}>
            {t('common.save')}
          </Button>
        }
      />

      <Card>
        <CardHeader title={t('recruitmentForm.fields')} description={t('recruitmentForm.fieldsHint')} />
        <CardBody className="space-y-2">
          {fields.map((field, i) => (
            <div
              key={field.key}
              className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={t('recruitmentForm.moveUp')}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={t('recruitmentForm.moveDown')}
                    disabled={i === fields.length - 1}
                    onClick={() => move(i, 1)}
                    className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                  >
                    ▼
                  </button>
                </div>
                <span className="min-w-40 text-sm font-medium text-slate-800 dark:text-slate-100">
                  {fieldLabel(field, t, locale)}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {t(field.type === 'builtin' ? 'recruitmentForm.builtin' : 'recruitmentForm.custom')}
                </span>
                <Checkbox
                  label={t('recruitmentForm.required')}
                  checked={field.required || isLocked(field)}
                  disabled={isLocked(field)}
                  onChange={(e) =>
                    edit(fields.map((f, idx) => (idx === i ? { ...f, required: e.target.checked } : f)))
                  }
                />
                <div className="ms-auto">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isLocked(field)}
                    aria-label={t('common.remove')}
                    onClick={() => edit(fields.filter((_, idx) => idx !== i))}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {field.type === 'custom' && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <Field label={`${t('recruitmentForm.label')} (ع)`}>
                    <Input
                      value={field.label.ar}
                      onChange={(e) => patchCustom(i, { label: { ...field.label, ar: e.target.value } })}
                    />
                  </Field>
                  <Field label={`${t('recruitmentForm.label')} (EN)`}>
                    <Input
                      value={field.label.en}
                      onChange={(e) => patchCustom(i, { label: { ...field.label, en: e.target.value } })}
                      dir="ltr"
                    />
                  </Field>
                  <Field label={t('recruitmentForm.kind')}>
                    <Select
                      value={field.kind}
                      onChange={(e) =>
                        patchCustom(i, { kind: e.target.value as RecruitmentFormInputKind })
                      }
                    >
                      {RECRUITMENT_FORM_INPUT_KINDS.map((k) => (
                        <option key={k} value={k}>{t(`recruitmentForm.kind.${k}`)}</option>
                      ))}
                    </Select>
                  </Field>
                  {field.kind === 'select' && (
                    <Field label={t('recruitmentForm.options')} hint={t('recruitmentForm.optionsHint')}>
                      <Input
                        value={field.options.map((o) => o.ar).join(', ')}
                        onChange={(e) =>
                          patchCustom(i, {
                            options: e.target.value
                              .split(',')
                              .map((o) => o.trim())
                              .filter((o) => o !== '')
                              .map((o) => ({ ar: o, en: o })),
                          })
                        }
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-3 pt-2">
            <Field label={t('recruitmentForm.addBuiltin')}>
              <Select
                value=""
                onChange={(e) => e.target.value !== '' && addBuiltin(e.target.value as RecruitmentFormBuiltin)}
                disabled={unusedBuiltins.length === 0}
              >
                <option value="">{t('recruitmentForm.pickField')}</option>
                {unusedBuiltins.map((key) => (
                  <option key={key} value={key}>
                    {fieldLabel({ type: 'builtin', key, required: false }, t, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="secondary" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={addCustom}>
              {t('recruitmentForm.addCustom')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('recruitmentForm.links')} description={t('recruitmentForm.linksHint')} />
        <CardBody className="space-y-3">
          {form.links.map((link) => (
            <div
              key={link.sourceId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <span className="min-w-40 text-sm font-medium text-slate-800 dark:text-slate-100">
                {link.sourceName[locale]}
              </span>
              {link.url === null ? (
                <span className="text-sm text-slate-400">{t('recruitmentForm.noLink')}</span>
              ) : (
                <>
                  <code
                    className="flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    dir="ltr"
                  >
                    {link.url}
                  </code>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('recruitmentForm.submissions')}: {link.submissions}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => copy(link.url ?? '')}>
                    {t('recruitmentForm.copy')}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={generate.isPending}
                onClick={() => generate.mutate(link.sourceId)}
              >
                {t(link.url === null ? 'recruitmentForm.generate' : 'recruitmentForm.regenerate')}
              </Button>
              {link.url !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={revoke.isPending}
                  onClick={() => revoke.mutate(link.sourceId)}
                >
                  {t('recruitmentForm.revoke')}
                </Button>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('recruitmentForm.internalSource')}
          description={t('recruitmentForm.internalSourceHint')}
        />
        <CardBody>
          <Field label={t('applicants.form.source')}>
            <Select
              value={internalSourceId}
              onChange={(e) => {
                setInternalSourceId(e.target.value);
                setDirty(true);
              }}
            >
              <option value="">{t('applicants.form.selectSource')}</option>
              {form.links.map((l) => (
                <option key={l.sourceId} value={l.sourceId}>{l.sourceName[locale]}</option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>
    </PageContainer>
  );
};
