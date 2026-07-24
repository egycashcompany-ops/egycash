// Electronic Employee File detail: the assembled recruitment history links and the Employee
// Timeline (built from recruitment milestones + free-form notes). Adding a note appends to the
// timeline (employeeFile.edit, version-checked). The file is a read/annotate handoff artifact.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type EmployeeTimelineEventType, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Textarea, FormActions } from '../../../../../shared/ui/form';
import { Timeline, type TimelineEntry } from '../../../../../shared/ui/Timeline';
import { type Tone } from '../../../../../shared/ui/Badge';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../../../shared/lib/format';
import { EmployeeFileStatusBadge } from '../components/EmployeeFileStatusBadge';
import { EmployeeFileDocuments } from '../components/EmployeeFileDocuments';
import { LinkedHistory } from '../components/LinkedHistory';
import { useAddEmployeeFileNote, useEmployeeFile } from '../api/employee-file-queries';

const EVENT_TONE: Record<EmployeeTimelineEventType, Tone> = {
  applicantRegistered: 'info',
  screeningAccepted: 'success',
  interviewPassed: 'success',
  offerAccepted: 'success',
  employeeCreated: 'brand',
  hiringDocumentsCompleted: 'success',
  fileOpened: 'brand',
  note: 'neutral',
};

export const EmployeeFileDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const { id = '' } = useParams();
  const { data: f, isLoading, isError, error, refetch } = useEmployeeFile(id);
  const addNote = useAddEmployeeFileNote(id);
  const [note, setNote] = useState('');

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || f === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const canAddNote = f.status === 'active' && can('employeeFile.edit');

  const timeline: TimelineEntry[] = f.timeline.map((entry, i) => ({
    id: `${i}-${entry.type}`,
    title: entry.type === 'note' && entry.detail !== null ? entry.detail : t(`employeeFiles.event.${entry.type}`),
    meta: formatDateTime(entry.at, locale),
    tone: EVENT_TONE[entry.type],
    ...(entry.type !== 'note' && entry.detail !== null ? { description: entry.detail } : {}),
  }));

  const submitNote = async (): Promise<void> => {
    if (note.trim() === '') return;
    try {
      await addNote.mutateAsync({ note: note.trim(), version: f.version });
      toast.success(t('employeeFiles.note.added'));
      setNote('');
    } catch {
      // surfaced globally
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('employeeFiles.detail.title', { code: f.employeeCode })}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.employeeFiles'), to: '/employee-files' },
          { label: f.employeeCode },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/employees/${f.employeeId}`} className="font-mono text-sm text-brand-600 hover:underline" dir="ltr">
          {f.employeeCode}
        </Link>
        <EmployeeFileStatusBadge status={f.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('employeeFiles.detail.timeline')} />
            <CardBody>
              {timeline.length === 0 ? <EmptyState title={t('employeeFiles.detail.timelineEmpty')} /> : <Timeline entries={timeline} />}
            </CardBody>
          </Card>

          <EmployeeFileDocuments fileId={f.id} documents={f.documents} version={f.version} />

          {canAddNote && (
            <Card>
              <CardHeader title={t('employeeFiles.note.add')} />
              <CardBody>
                <Field label={t('employeeFiles.note.note')} required>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
                </Field>
                <FormActions>
                  <Button loading={addNote.isPending} disabled={note.trim() === ''} onClick={() => void submitNote()}>
                    {t('employeeFiles.note.submit')}
                  </Button>
                </FormActions>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('employeeFiles.detail.links')} description={t('employeeFiles.detail.linksHint')} />
            <CardBody>
              <LinkedHistory links={f.links} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('employeeFiles.detail.summary')} />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">{t('employeeFiles.columns.status')}</dt>
                  <dd className="mt-1"><EmployeeFileStatusBadge status={f.status} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employeeFiles.detail.employee')}</dt>
                  <dd className="mt-1">
                    <Link to={`/employees/${f.employeeId}`} className="font-mono text-xs text-brand-600 hover:underline" dir="ltr">
                      {f.employeeCode}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employeeFiles.columns.created')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(f.createdAt, locale)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
};
