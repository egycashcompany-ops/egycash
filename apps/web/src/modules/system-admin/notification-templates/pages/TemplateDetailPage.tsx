// One notification template: its content, its version history, and a preview.
//
// The three things this screen has to be honest about, none of which the API says on its own:
//
//   • **Every save publishes a NEW VERSION.** The id in the URL stops being the latest one the
//     moment an edit succeeds, so the screen navigates to the new version rather than showing a
//     stale row that still looks current.
//   • **A protected template has no off switch**, because deactivating it does not hide it — it
//     stops the notification the platform sends. The control is withheld and the reason is printed;
//     the server refuses either way.
//   • **Versions are read-only here.** Restoring an old one would publish a fourth version carrying
//     the first one's text, which is a different act than "undo" and deserves its own decision.
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type NotificationChannel, type NotificationTemplateDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { ActorById } from '../../../../platform/directory';
import { Badge, Button, Card, CardBody, CardHeader } from '../../../../shared/ui';
import { Field, Input } from '../../../../shared/ui/form';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../../shared/lib/errors';
import { formatDateTime } from '../../../../shared/lib/format';
import {
  useDeactivateTemplate,
  usePreviewTemplate,
  useTemplate,
  useTemplateVersions,
  useTestSendTemplate,
  useUpdateTemplate,
} from '../api/template-api';
import { TemplateFormDialog } from '../components/TemplateFormDialog';
import { draftFrom, toUpdateBody, type TemplateDraft } from '../lib/template-form';

const TABS = ['content', 'versions', 'preview'] as const;
type Tab = (typeof TABS)[number];

const ContentCard = ({ template }: { template: NotificationTemplateDto }): JSX.Element => {
  const t = useT();
  return (
    <Card>
      <CardHeader title={t('systemAdmin.templates.tabs.content')} />
      <CardBody className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">{t('systemAdmin.templates.fields.category')}</dt>
            <dd>{t(`systemAdmin.templates.category.${template.category}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('systemAdmin.templates.fields.priority')}</dt>
            <dd>{t(`systemAdmin.templates.priority.${template.priority}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('systemAdmin.templates.fields.channels')}</dt>
            <dd className="flex flex-wrap gap-1">
              {template.channels.map((channel) => (
                <Badge key={channel} tone="neutral">
                  {t(`systemAdmin.templates.channel.${channel}`)}
                </Badge>
              ))}
            </dd>
          </div>
        </dl>
        {template.subject !== null && (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextBlock label={t('systemAdmin.templates.fields.subjectAr')} dir="rtl" text={template.subject.ar} />
            <TextBlock label={t('systemAdmin.templates.fields.subjectEn')} dir="ltr" text={template.subject.en} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextBlock label={t('systemAdmin.templates.fields.bodyAr')} dir="rtl" text={template.body.ar} />
          <TextBlock label={t('systemAdmin.templates.fields.bodyEn')} dir="ltr" text={template.body.en} />
        </div>
        <div>
          <p className="text-xs text-slate-500">{t('systemAdmin.templates.fields.variables')}</p>
          <p className="mt-1 flex flex-wrap gap-1">
            {template.variables.length === 0 ? (
              <span className="text-xs text-slate-400">{t('systemAdmin.templates.noVariables')}</span>
            ) : (
              template.variables.map((name) => (
                <code key={name} dir="ltr" className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                  {`{{${name}}}`}
                </code>
              ))
            )}
          </p>
        </div>
      </CardBody>
    </Card>
  );
};

/** A message body is prose in a known direction — never the page's. */
const TextBlock = ({ label, dir, text }: { label: string; dir: 'rtl' | 'ltr'; text: string }): JSX.Element => (
  <div>
    <p className="text-xs text-slate-500">{label}</p>
    <pre
      dir={dir}
      className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm dark:bg-slate-800/60"
    >
      {text}
    </pre>
  </div>
);

const VersionsCard = ({ id }: { id: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const versions = useTemplateVersions(id);
  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.templates.tabs.versions')}
        description={t('systemAdmin.templates.versionsHint')}
      />
      <CardBody>
        {versions.isLoading ? (
          <LoadingState />
        ) : versions.error !== null ? (
          <ErrorState onRetry={() => void versions.refetch()} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(versions.data ?? []).map((version) => (
              <li key={version.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span dir="ltr" className="font-mono text-xs">
                  v{version.version}
                </span>
                {version.isLatest && <Badge tone="brand">{t('systemAdmin.templates.latest')}</Badge>}
                <Badge tone={version.status === 'active' ? 'success' : 'neutral'}>
                  {t(`systemAdmin.templates.status.${version.status}`)}
                </Badge>
                <span className="text-slate-500">{formatDateTime(version.createdAt, locale)}</span>
                {version.createdBy !== null && <ActorById userId={version.createdBy} />}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
};

const PreviewCard = ({ template }: { template: NotificationTemplateDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [data, setData] = useState<Record<string, string>>({});
  const [channel, setChannel] = useState<NotificationChannel>(template.channels[0] ?? 'inApp');
  const preview = usePreviewTemplate();
  const testSend = useTestSendTemplate();
  const locale = useAppSelector((state) => state.locale.locale);

  const sample = Object.fromEntries(template.variables.map((name) => [name, data[name] ?? '']));

  return (
    <Card>
      <CardHeader
        title={t('systemAdmin.templates.tabs.preview')}
        description={t('systemAdmin.templates.previewHint')}
      />
      <CardBody className="space-y-4">
        {template.variables.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {template.variables.map((name) => (
              <Field key={name} label={`{{${name}}}`} htmlFor={`preview-${name}`}>
                <Input
                  id={`preview-${name}`}
                  value={data[name] ?? ''}
                  onChange={(e) => setData({ ...data, [name]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              preview.mutate(
                { id: template.id, body: { data: sample } },
                { onError: (error) => toast.error(errorMessage(error, locale)) },
              )
            }
          >
            {t('systemAdmin.templates.renderPreview')}
          </Button>
          {/* A real message, to the caller alone — and audited server-side since P10. */}
          {can('notificationTemplate.test') && (
            <>
              <select
                aria-label={t('systemAdmin.templates.fields.channels')}
                value={channel}
                onChange={(e) => setChannel(e.target.value as NotificationChannel)}
                className="rounded-lg border border-slate-200 px-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {template.channels.map((value) => (
                  <option key={value} value={value}>
                    {t(`systemAdmin.templates.channel.${value}`)}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                onClick={() =>
                  testSend.mutate(
                    { id: template.id, body: { data: sample, channel } },
                    {
                      onSuccess: () => toast.success(t('systemAdmin.templates.testSent')),
                      onError: (error) => toast.error(errorMessage(error, locale)),
                    },
                  )
                }
              >
                {t('systemAdmin.templates.testSend')}
              </Button>
            </>
          )}
        </div>
        {preview.data !== undefined && (
          <div className="grid gap-3 sm:grid-cols-2">
            {preview.data.subject !== null && (
              <>
                <TextBlock label={t('systemAdmin.templates.fields.subjectAr')} dir="rtl" text={preview.data.subject.ar} />
                <TextBlock label={t('systemAdmin.templates.fields.subjectEn')} dir="ltr" text={preview.data.subject.en} />
              </>
            )}
            <TextBlock label={t('systemAdmin.templates.fields.bodyAr')} dir="rtl" text={preview.data.body.ar} />
            <TextBlock label={t('systemAdmin.templates.fields.bodyEn')} dir="ltr" text={preview.data.body.en} />
          </div>
        )}
      </CardBody>
    </Card>
  );
};

export const TemplateDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '')
    ? (sp.get('tab') as Tab)
    : 'content';
  const locale = useAppSelector((state) => state.locale.locale);

  const query = useTemplate(id);
  const update = useUpdateTemplate();
  const deactivate = useDeactivateTemplate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);

  // The dialog opens on the version currently on screen; reopening after a save must not show the
  // version that was replaced.
  useEffect(() => {
    if (query.data !== undefined && !editing) setDraft(draftFrom(query.data));
  }, [query.data, editing]);

  if (query.isLoading) return <PageContainer><LoadingState /></PageContainer>;
  if (query.error !== null || query.data === undefined) {
    return (
      <PageContainer>
        <ErrorState onRetry={() => void query.refetch()} />
      </PageContainer>
    );
  }
  const template = query.data;

  const save = (): void => {
    if (draft === null) return;
    update.mutate(
      { id: template.id, body: toUpdateBody(draft) },
      {
        onSuccess: (next) => {
          setEditing(false);
          toast.success(t('systemAdmin.templates.savedAsVersion', { version: next.version }));
          // The edit published a new version; the id in the URL is no longer the latest.
          navigate(`../${next.id}?tab=content`, { replace: true });
        },
        onError: (error) => toast.error(errorMessage(error, locale)),
      },
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={template.key}
        description={t('systemAdmin.templates.versionLabel', { version: template.version })}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('notificationTemplate.edit') && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('systemAdmin.templates.edit')}
              </Button>
            )}
            {/* Withheld rather than shown-and-refused: the server would refuse it, and an admin
                should not have to press a button to discover a rule. */}
            {can('notificationTemplate.delete') &&
              !template.isProtected &&
              template.status === 'active' && (
                <Button
                  variant="danger"
                  onClick={() =>
                    deactivate.mutate(template.id, {
                      onSuccess: (next) => navigate(`../${next.id}?tab=content`, { replace: true }),
                      onError: (error) => toast.error(errorMessage(error, locale)),
                    })
                  }
                >
                  {t('systemAdmin.templates.deactivate')}
                </Button>
              )}
          </div>
        }
      />

      {template.isProtected && (
        <p className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          {t('systemAdmin.templates.protectedHint')}
        </p>
      )}

      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => {
              const next = new URLSearchParams(sp);
              next.set('tab', name);
              setSp(next, { replace: true });
            }}
            className={
              tab === name
                ? 'rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                : 'rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }
          >
            {t(`systemAdmin.templates.tabs.${name}`)}
          </button>
        ))}
      </div>

      {tab === 'content' && <ContentCard template={template} />}
      {tab === 'versions' && <VersionsCard id={template.id} />}
      {tab === 'preview' && <PreviewCard template={template} />}

      {draft !== null && (
        <TemplateFormDialog
          open={editing}
          mode="edit"
          draft={draft}
          saving={update.isPending}
          onChange={setDraft}
          onSubmit={save}
          onClose={() => setEditing(false)}
        />
      )}
    </PageContainer>
  );
};

export default TemplateDetailPage;
