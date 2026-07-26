// The D7 template editor: structured sections (header/body/footer) in TipTap, signature
// blocks, the variable browser (insert-at-caret) and the SERVER sample preview (A18 —
// the same renderer that generates contracts). Version rules surface as banners:
// published versions fork the next draft on save (A17/A19), archived versions are
// read-only (clone instead), and only a draft can publish.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Editor } from '@tiptap/react';
import { type ContractTemplateLanguage, type Locale, type SignatureBlock } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  Field,
  Input,
  LoadingState,
  Select,
  toast,
} from '../../../../shared/ui';
import { localized } from '../../../../shared/lib/format';
import { previewContract } from '../api/contract-api';
import {
  useContractTemplate,
  useContractTypes,
  useCreateContractTemplate,
  usePublishContractTemplate,
  useTemplateVersions,
  useUpdateContractTemplate,
} from '../api/contract-queries';
import { RichTextSection } from '../components/RichTextSection';
import { VariableBrowser } from '../components/VariableBrowser';
import { TemplateStatusBadge } from '../components/ContractStatusBadge';

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'signer';

export const TemplateEditorPage = (): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const isNew = id === '';

  const { data: existing, isLoading } = useContractTemplate(id);
  const { data: types } = useContractTypes();
  const { data: versions } = useTemplateVersions(existing?.key ?? '');
  const create = useCreateContractTemplate();
  const update = useUpdateContractTemplate();
  const publish = usePublishContractTemplate();

  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [language, setLanguage] = useState<ContractTemplateLanguage>('ar');
  const [contractTypeId, setContractTypeId] = useState('');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [signatures, setSignatures] = useState<SignatureBlock[]>([
    { key: 'employer', label: 'الطرف الأول' },
    { key: 'employee', label: 'الطرف الثاني' },
  ]);
  const [dirty, setDirty] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [loadedId, setLoadedId] = useState('');

  // Hydrate from the loaded version (also after save navigations).
  useEffect(() => {
    if (existing === undefined || loadedId === existing.id) return;
    setLoadedId(existing.id);
    setNameAr(existing.name.ar);
    setNameEn(existing.name.en);
    setLanguage(existing.language);
    setContractTypeId(existing.contractTypeId);
    setHeader(existing.sections.header);
    setBody(existing.sections.body);
    setFooter(existing.sections.footer);
    setSignatures(existing.signatures);
    setDirty(false);
  }, [existing, loadedId]);

  const readOnly = existing?.status === 'archived';
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const mark = <T,>(setter: (v: T) => void) => (v: T): void => {
    setter(v);
    setDirty(true);
  };

  const save = async (): Promise<{ id: string; version: number } | null> => {
    if (nameAr.trim() === '' || nameEn.trim() === '' || contractTypeId === '' || body.trim() === '') {
      toast.warning(t('contracts.templates.incomplete'));
      return null;
    }
    try {
      if (isNew) {
        const created = await create.mutateAsync({
          name: { ar: nameAr, en: nameEn },
          language,
          contractTypeId,
          sections: { header, body, footer },
          logoFileId: null,
          signatures,
        });
        toast.success(t('contracts.templates.saved'));
        navigate(`/contracts/templates/${created.id}`, { replace: true });
        return { id: created.id, version: created.version };
      }
      const updated = await update.mutateAsync({
        id,
        body: {
          name: { ar: nameAr, en: nameEn },
          contractTypeId,
          sections: { header, body, footer },
          signatures,
          version: existing?.version ?? 0,
        },
      });
      setDirty(false);
      if (updated.id !== id) {
        // A published version forked the next draft (A17/A19).
        toast.success(t('contracts.templates.forked', { version: updated.templateVersion }));
        navigate(`/contracts/templates/${updated.id}`, { replace: true });
      } else {
        toast.success(t('contracts.templates.saved'));
      }
      return { id: updated.id, version: updated.version };
    } catch {
      return null; // surfaced globally
    }
  };

  const doPreview = async (): Promise<void> => {
    const target = isNew || dirty ? await save() : { id, version: existing?.version ?? 0 };
    if (target === null) return;
    try {
      const result = await previewContract({ templateId: target.id, overrides: {} });
      setPreviewHtml(result.html);
    } catch {
      toast.error(t('contracts.templates.previewFailed'));
    }
  };

  const doPublish = async (): Promise<void> => {
    const target = dirty || isNew ? await save() : { id, version: existing?.version ?? 0 };
    if (target === null) return;
    try {
      await publish.mutateAsync(target);
      toast.success(t('contracts.templates.published'));
    } catch {
      // surfaced globally
    }
  };

  if (!isNew && isLoading) return <PageContainer><LoadingState /></PageContainer>;

  return (
    <PageContainer wide>
      <PageHeader
        title={isNew ? t('contracts.templates.new') : localized({ ar: nameAr, en: nameEn }, locale) || t('contracts.templates.edit')}
        description={existing === undefined ? '' : `v${existing.templateVersion}`}
        breadcrumbs={[
          { label: t('contracts.module.title'), to: '/contracts' },
          { label: t('contracts.templates.title'), to: '/contracts/templates' },
          { label: isNew ? t('contracts.templates.new') : `v${existing?.templateVersion ?? ''}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {existing !== undefined && <TemplateStatusBadge status={existing.status} />}
            <Button variant="secondary" onClick={() => void doPreview()}>
              {t('contracts.templates.preview')}
            </Button>
            {!readOnly && (
              <>
                <Button
                  variant="secondary"
                  loading={create.isPending || update.isPending}
                  onClick={() => void save()}
                >
                  {t('common.save')}
                </Button>
                {(isNew || existing?.status === 'draft' || dirty) && (
                  <Button loading={publish.isPending} onClick={() => void doPublish()}>
                    {t('contracts.templates.publish')}
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      {existing?.status === 'published' && (
        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
          {t('contracts.templates.publishedBanner')}
        </div>
      )}
      {readOnly && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {t('contracts.templates.archivedBanner')}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title={t('contracts.templates.settings')} />
            <CardBody>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('contracts.templates.nameAr')} required>
                  <Input dir="rtl" value={nameAr} onChange={(e) => mark(setNameAr)(e.target.value)} disabled={readOnly} />
                </Field>
                <Field label={t('contracts.templates.nameEn')} required>
                  <Input dir="ltr" value={nameEn} onChange={(e) => mark(setNameEn)(e.target.value)} disabled={readOnly} />
                </Field>
                <Field
                  label={t('contracts.templates.language')}
                  hint={isNew ? t('contracts.templates.languageHint') : undefined}
                >
                  <Select
                    value={language}
                    onChange={(e) => mark(setLanguage)(e.target.value as ContractTemplateLanguage)}
                    disabled={!isNew}
                  >
                    <option value="ar">{t('contracts.language.ar')}</option>
                    <option value="en">{t('contracts.language.en')}</option>
                  </Select>
                </Field>
                <Field label={t('contracts.columns.type')} required>
                  <Select
                    value={contractTypeId}
                    onChange={(e) => mark(setContractTypeId)(e.target.value)}
                    disabled={readOnly}
                  >
                    <option value="">—</option>
                    {(types ?? []).filter((x) => x.status === 'active').map((x) => (
                      <option key={x.id} value={x.id}>{localized(x.name, locale)}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('contracts.templates.sectionHeader')} />
            <CardBody>
              <RichTextSection
                value={header}
                onChange={mark(setHeader)}
                dir={dir}
                minHeightClass="min-h-20"
                onEditorFocus={setActiveEditor}
                disabled={readOnly}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('contracts.templates.sectionBody')} description={t('contracts.templates.bodyHint')} />
            <CardBody>
              <RichTextSection
                value={body}
                onChange={mark(setBody)}
                dir={dir}
                minHeightClass="min-h-96"
                onEditorFocus={setActiveEditor}
                disabled={readOnly}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('contracts.templates.sectionFooter')} />
            <CardBody>
              <RichTextSection
                value={footer}
                onChange={mark(setFooter)}
                dir={dir}
                minHeightClass="min-h-20"
                onEditorFocus={setActiveEditor}
                disabled={readOnly}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('contracts.templates.signatures')} description={t('contracts.templates.signaturesHint')} />
            <CardBody>
              <ul className="space-y-2">
                {signatures.map((block, index) => (
                  <li key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <Input
                      placeholder={t('contracts.templates.signatureLabel')}
                      value={block.label}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = [...signatures];
                        next[index] = { ...block, label: e.target.value, key: slug(e.target.value) || block.key };
                        mark(setSignatures)(next);
                      }}
                    />
                    <Input
                      placeholder={t('contracts.templates.signatureName')}
                      value={block.name ?? ''}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = [...signatures];
                        next[index] = { ...block, name: e.target.value };
                        mark(setSignatures)(next);
                      }}
                    />
                    <Input
                      placeholder={t('contracts.templates.signatureTitle')}
                      value={block.title ?? ''}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = [...signatures];
                        next[index] = { ...block, title: e.target.value };
                        mark(setSignatures)(next);
                      }}
                    />
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => mark(setSignatures)(signatures.filter((_, i) => i !== index))}
                      >
                        {t('common.remove')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {!readOnly && signatures.length < 10 && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  onClick={() => mark(setSignatures)([...signatures, { key: `signer-${signatures.length + 1}`, label: '' }])}
                >
                  {t('contracts.templates.addSignature')}
                </Button>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <VariableBrowser
            onInsert={(key) => {
              if (readOnly) return;
              if (activeEditor === null) {
                toast.info(t('contracts.templates.focusFirst'));
                return;
              }
              activeEditor.chain().focus().insertContent(`{{${key}}}`).run();
            }}
          />
          {existing !== undefined && (
            <Card>
              <CardHeader title={t('contracts.templates.versions')} description={t('contracts.templates.versionsHint')} />
              <CardBody>
                <ul className="space-y-1 text-sm">
                  {(versions ?? []).map((v) => (
                    <li key={v.id} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      {v.id === existing.id ? (
                        <span className="font-medium">v{v.templateVersion} — {t('contracts.detail.thisVersion')}</span>
                      ) : (
                        <button
                          type="button"
                          className="text-brand-700 hover:underline dark:text-brand-300"
                          onClick={() => navigate(`/contracts/templates/${v.id}`)}
                        >
                          v{v.templateVersion}
                        </button>
                      )}
                      <TemplateStatusBadge status={v.status} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Dialog
        open={previewHtml !== null}
        onClose={() => setPreviewHtml(null)}
        title={t('contracts.templates.previewTitle')}
        size="lg"
      >
        <p className="mb-3 text-xs text-slate-400">{t('contracts.templates.previewSampleHint')}</p>
        {previewHtml !== null && (
          <iframe
            title={t('contracts.templates.previewTitle')}
            sandbox=""
            srcDoc={previewHtml}
            className="h-[70vh] w-full rounded border border-slate-200 bg-white dark:border-slate-700"
          />
        )}
      </Dialog>
    </PageContainer>
  );
};
