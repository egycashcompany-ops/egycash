// Hiring-documents detail: the per-type document checklist with upload / replace / version-history /
// download, and the Complete action — blocked (with the missing-required list) until every required
// document is present. All mutations are permission-gated and version-checked.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type Locale, type LocalizedString } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDateTime, localized } from '../../../../../shared/lib/format';
import { HiringDocsStatusBadge } from '../components/HiringDocsStatusBadge';
import { DocumentsList } from '../components/DocumentsList';
import { UploadDocumentDialog } from '../components/UploadDocumentDialog';
import { DocumentVersionsDialog } from '../components/DocumentVersionsDialog';
import { useCompleteHiringDocs, useHiringDocs, useHiringDocumentTypes } from '../api/hiring-documents-queries';

type Active =
  | { kind: 'upload' | 'replace' | 'versions'; typeId: string; typeName: LocalizedString }
  | { kind: 'complete' }
  | null;

export const HiringDocsDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const { id = '' } = useParams();
  const { data: h, isLoading, isError, error, refetch } = useHiringDocs(id);
  const { data: types = [] } = useHiringDocumentTypes();
  const complete = useCompleteHiringDocs(id);
  const [active, setActive] = useState<Active>(null);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || h === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const isInProgress = h.status === 'inProgress';
  const canUpload = isInProgress && can('hiringDocuments.upload');
  const completable = h.missingRequired.length === 0;

  const typeNameOf = (typeId: string): LocalizedString => {
    const ty = types.find((x) => x.id === typeId);
    if (ty !== undefined) return ty.name;
    const doc = h.documents.find((d) => d.typeId === typeId);
    return doc?.typeName ?? { ar: typeId, en: typeId };
  };
  const missingNames = h.missingRequired.map((key) => {
    const ty = types.find((x) => x.key === key);
    return ty === undefined ? key : localized(ty.name, locale);
  });

  const submitComplete = async (): Promise<void> => {
    try {
      await complete.mutateAsync({ version: h.version });
      toast.success(t('hiringDocs.complete.done'));
      setActive(null);
    } catch {
      // surfaced globally
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('hiringDocs.detail.title', { code: h.employeeCode })}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.hiringDocuments'), to: '/hiring-documents' },
          { label: h.employeeCode },
        ]}
        actions={
          isInProgress ? (
            <Can permission="hiringDocuments.complete">
              <Button size="sm" disabled={!completable} onClick={() => setActive({ kind: 'complete' })}>
                {t('hiringDocs.actions.complete')}
              </Button>
            </Can>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/employees/${h.employeeId}`} className="font-mono text-sm text-brand-600 hover:underline" dir="ltr">
          {h.employeeCode}
        </Link>
        <HiringDocsStatusBadge status={h.status} />
      </div>

      {isInProgress && !completable && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {t('hiringDocs.detail.missingRequired', { list: missingNames.join('، ') })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('hiringDocs.detail.documents')} />
            <CardBody>
              <DocumentsList
                docs={h}
                types={types}
                canUpload={canUpload}
                onUpload={(typeId) => setActive({ kind: 'upload', typeId, typeName: typeNameOf(typeId) })}
                onReplace={(typeId) => setActive({ kind: 'replace', typeId, typeName: typeNameOf(typeId) })}
                onVersions={(typeId) => setActive({ kind: 'versions', typeId, typeName: typeNameOf(typeId) })}
              />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('hiringDocs.detail.summary')} />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">{t('hiringDocs.columns.status')}</dt>
                  <dd className="mt-1"><HiringDocsStatusBadge status={h.status} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('hiringDocs.detail.employee')}</dt>
                  <dd className="mt-1">
                    <Link to={`/employees/${h.employeeId}`} className="font-mono text-xs text-brand-600 hover:underline" dir="ltr">
                      {h.employeeCode}
                    </Link>
                  </dd>
                </div>
                {h.completedAt !== null && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('hiringDocs.detail.completedAt')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(h.completedAt, locale)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-slate-400">{t('hiringDocs.columns.created')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(h.createdAt, locale)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      {(active?.kind === 'upload' || active?.kind === 'replace') && (
        <UploadDocumentDialog
          mode={active.kind}
          onClose={() => setActive(null)}
          hiringDocsId={h.id}
          typeId={active.typeId}
          typeName={active.typeName}
          version={h.version}
        />
      )}
      {active?.kind === 'versions' && (
        <DocumentVersionsDialog
          onClose={() => setActive(null)}
          hiringDocsId={h.id}
          typeId={active.typeId}
          typeName={active.typeName}
        />
      )}
      {active?.kind === 'complete' && (
        <Dialog
          open
          onClose={() => setActive(null)}
          title={t('hiringDocs.complete.title')}
          description={t('hiringDocs.complete.body')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setActive(null)}>{t('common.cancel')}</Button>
              <Button loading={complete.isPending} onClick={() => void submitComplete()}>{t('hiringDocs.actions.complete')}</Button>
            </>
          }
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('hiringDocs.complete.confirm')}</p>
        </Dialog>
      )}
    </PageContainer>
  );
};
