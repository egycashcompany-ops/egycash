// Template administration (frozen design §4 + D4): latest version per key with status /
// language / type, Create / Edit / Clone / Archive; plus the contract-types catalog
// (allowsEndDate, the Q3 multiple-active override) for holders of contractType.manage.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type ContractTemplateDto,
  type ContractTypeDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  toast,
  type Column,
} from '../../../../shared/ui';
import { formatDateTime, localized } from '../../../../shared/lib/format';
import {
  useArchiveContractTemplate,
  useCloneContractTemplate,
  useContractTemplates,
  useContractTypes,
  useCreateContractType,
  useUpdateContractType,
} from '../api/contract-queries';
import { TemplateStatusBadge } from '../components/ContractStatusBadge';

const CloneDialog = ({
  template,
  onClose,
}: {
  template: ContractTemplateDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const clone = useCloneContractTemplate();
  const [nameAr, setNameAr] = useState(`${template.name.ar} (نسخة)`);
  const [nameEn, setNameEn] = useState(`${template.name.en} (copy)`);
  const [language, setLanguage] = useState(template.language);

  const submit = async (): Promise<void> => {
    try {
      const next = await clone.mutateAsync({
        id: template.id,
        body: { name: { ar: nameAr, en: nameEn }, language },
      });
      toast.success(t('contracts.templates.cloned'));
      onClose();
      navigate(`/contracts/templates/${next.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('contracts.templates.cloneTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} loading={clone.isPending}>{t('contracts.templates.clone')}</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-500">{t('contracts.templates.cloneHint')}</p>
      <div className="space-y-4">
        <Field label={t('contracts.templates.nameAr')} required>
          <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('contracts.templates.nameEn')} required>
          <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={t('contracts.templates.language')}>
          <Select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
            <option value="ar">{t('contracts.language.ar')}</option>
            <option value="en">{t('contracts.language.en')}</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
};

const TypeDialog = ({
  type,
  onClose,
}: {
  type: ContractTypeDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const createType = useCreateContractType();
  const updateType = useUpdateContractType();
  const [nameAr, setNameAr] = useState(type?.name.ar ?? '');
  const [nameEn, setNameEn] = useState(type?.name.en ?? '');
  const [allowsEndDate, setAllowsEndDate] = useState(type?.allowsEndDate ?? true);
  const [multipleActiveAllowed, setMultipleActiveAllowed] = useState(type?.multipleActiveAllowed ?? false);

  const submit = async (): Promise<void> => {
    try {
      if (type === null) {
        await createType.mutateAsync({ name: { ar: nameAr, en: nameEn }, allowsEndDate, multipleActiveAllowed });
      } else {
        await updateType.mutateAsync({
          id: type.id,
          body: { name: { ar: nameAr, en: nameEn }, allowsEndDate, multipleActiveAllowed, version: type.version },
        });
      }
      toast.success(t('contracts.types.saved'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={type === null ? t('contracts.types.new') : t('contracts.types.edit')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            onClick={() => void submit()}
            loading={createType.isPending || updateType.isPending}
            disabled={nameAr.trim() === '' || nameEn.trim() === ''}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('contracts.templates.nameAr')} required>
          <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('contracts.templates.nameEn')} required>
          <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Checkbox
          label={t('contracts.types.allowsEndDate')}
          checked={allowsEndDate}
          onChange={(e) => setAllowsEndDate(e.target.checked)}
        />
        <Checkbox
          label={t('contracts.types.multipleActive')}
          checked={multipleActiveAllowed}
          onChange={(e) => setMultipleActiveAllowed(e.target.checked)}
        />
      </div>
    </Dialog>
  );
};

export const TemplatesListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: templates, isLoading, isError, error, refetch } = useContractTemplates();
  const { data: types } = useContractTypes();
  const archiveTemplate = useArchiveContractTemplate();
  const [cloneTarget, setCloneTarget] = useState<ContractTemplateDto | null>(null);
  const [typeDialog, setTypeDialog] = useState<{ type: ContractTypeDto | null } | null>(null);

  const typeName = (typeId: string): string => {
    const type = (types ?? []).find((x) => x.id === typeId);
    return type === undefined ? '—' : localized(type.name, locale);
  };

  const columns: Column<ContractTemplateDto>[] = [
    { key: 'name', header: t('contracts.templates.name'), render: (x) => localized(x.name, locale) },
    {
      key: 'language',
      header: t('contracts.templates.language'),
      render: (x) => (x.language === 'ar' ? t('contracts.language.ar') : t('contracts.language.en')),
    },
    { key: 'type', header: t('contracts.columns.type'), render: (x) => typeName(x.contractTypeId) },
    {
      key: 'version',
      header: t('contracts.templates.version'),
      align: 'center',
      render: (x) => (
        <span className="font-mono text-xs">
          v{x.templateVersion}
          {typeof x.publishedTemplateVersion === 'number' && x.publishedTemplateVersion !== x.templateVersion && (
            <span className="ms-1 text-slate-400">({t('contracts.templates.publishedShort', { version: x.publishedTemplateVersion })})</span>
          )}
        </span>
      ),
    },
    { key: 'status', header: t('contracts.columns.status'), render: (x) => <TemplateStatusBadge status={x.status} /> },
    {
      key: 'updated',
      header: t('contracts.templates.updatedAt'),
      render: (x) => formatDateTime(x.updatedAt, locale),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (x) => (
        <span className="flex justify-end gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCloneTarget(x); }}
            className="rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800"
          >
            {t('contracts.templates.clone')}
          </button>
          {x.status !== 'archived' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void archiveTemplate
                  .mutateAsync({ id: x.id, version: x.version })
                  .then(() => toast.success(t('contracts.templates.archived')))
                  .catch(() => undefined);
              }}
              className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-slate-800"
            >
              {t('contracts.templates.archive')}
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer wide>
      <PageHeader
        title={t('contracts.templates.title')}
        description={t('contracts.templates.subtitle')}
        breadcrumbs={[{ label: t('contracts.module.title'), to: '/contracts' }, { label: t('contracts.templates.title') }]}
        actions={
          <Button onClick={() => navigate('/contracts/templates/new')}>{t('contracts.templates.new')}</Button>
        }
      />
      <DataTable
        columns={columns}
        rows={templates ?? []}
        rowKey={(x) => x.id}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        onRowClick={(x) => navigate(`/contracts/templates/${x.id}`)}
        empty={<EmptyState title={t('contracts.templates.empty')} />}
      />

      {can('contractType.manage') && (
        <div className="mt-6">
          <Card>
            <CardHeader
              title={t('contracts.types.title')}
              description={t('contracts.types.subtitle')}
              actions={
                <Button size="sm" variant="secondary" onClick={() => setTypeDialog({ type: null })}>
                  {t('contracts.types.new')}
                </Button>
              }
            />
            <CardBody>
              {(types ?? []).length === 0 ? (
                <EmptyState title={t('contracts.types.empty')} />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(types ?? []).map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        {localized(x.name, locale)}
                        {x.status === 'archived' && <Badge tone="neutral">{t('contracts.status.archived')}</Badge>}
                        {!x.allowsEndDate && <Badge tone="info">{t('contracts.types.openEndedOnly')}</Badge>}
                        {x.multipleActiveAllowed && <Badge tone="warning">{t('contracts.types.multipleActiveShort')}</Badge>}
                      </span>
                      <button
                        type="button"
                        onClick={() => setTypeDialog({ type: x })}
                        className="text-xs text-brand-700 hover:underline dark:text-brand-300"
                      >
                        {t('common.edit')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {cloneTarget !== null && <CloneDialog template={cloneTarget} onClose={() => setCloneTarget(null)} />}
      {typeDialog !== null && <TypeDialog type={typeDialog.type} onClose={() => setTypeDialog(null)} />}
    </PageContainer>
  );
};
