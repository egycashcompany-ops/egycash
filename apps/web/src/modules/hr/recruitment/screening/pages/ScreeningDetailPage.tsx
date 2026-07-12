// Screening details: applicant link, status, the notes timeline (with an add-note form while
// pending), the decision read-out, and the Accept/Reject actions — all permission-gated and
// version-checked.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type ScreeningOutcome } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Textarea, FormActions } from '../../../../../shared/ui/form';
import { Timeline, type TimelineEntry } from '../../../../../shared/ui/Timeline';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../../../shared/lib/format';
import { ScreeningStatusBadge } from '../components/ScreeningStatusBadge';
import { DecideDialog } from '../components/DecideDialog';
import { useAddScreeningNote, useScreening } from '../api/screening-queries';

export const ScreeningDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const can = useCan();
  const { id = '' } = useParams();
  const { data: s, isLoading, isError, error, refetch } = useScreening(id);

  const addNote = useAddScreeningNote(id);
  const [note, setNote] = useState('');
  const [decide, setDecide] = useState<ScreeningOutcome | null>(null);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || s === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const isPending = s.status === 'pending';

  const submitNote = async (): Promise<void> => {
    if (note.trim() === '') return;
    try {
      await addNote.mutateAsync({ note: note.trim(), version: s.version });
      toast.success(t('screening.notes.added'));
      setNote('');
    } catch {
      // surfaced globally
    }
  };

  const timeline: TimelineEntry[] = s.notes.map((n, i) => ({
    id: `note-${i}`,
    title: n.text,
    meta: formatDateTime(n.at, locale),
    tone: 'neutral',
  }));
  if (s.decision !== null) {
    const reason = s.decision.reason;
    timeline.push({
      id: 'decision',
      title: s.decision.outcome === 'accepted' ? t('screening.decide.acceptedDone') : t('screening.decide.rejectedDone'),
      meta: formatDateTime(s.decision.decidedAt, locale),
      tone: s.decision.outcome === 'accepted' ? 'success' : 'danger',
      ...(reason === null ? {} : { description: reason }),
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('screening.detail.title', { code: s.applicantCode })}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.screening'), to: '/screening' },
          { label: s.applicantCode },
        ]}
        actions={
          isPending ? (
            <Can permission="screening.decide">
              <Button size="sm" variant="secondary" onClick={() => setDecide('accepted')}>{t('screening.actions.accept')}</Button>
              <Button size="sm" variant="danger" onClick={() => setDecide('rejected')}>{t('screening.actions.reject')}</Button>
            </Can>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/applicants/${s.applicantId}`} className="font-mono text-sm text-brand-600 hover:underline" dir="ltr">
          {s.applicantCode}
        </Link>
        <ScreeningStatusBadge status={s.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('screening.notes.title')} />
            <CardBody>
              {timeline.length === 0 ? (
                <EmptyState title={t('screening.notes.empty')} />
              ) : (
                <Timeline entries={timeline} />
              )}
            </CardBody>
          </Card>

          {isPending && can('screening.edit') && (
            <Card>
              <CardHeader title={t('screening.notes.add')} />
              <CardBody>
                <Field label={t('screening.notes.note')} required>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                </Field>
                <FormActions>
                  <Button loading={addNote.isPending} disabled={note.trim() === ''} onClick={() => void submitNote()}>
                    {t('screening.notes.submit')}
                  </Button>
                </FormActions>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('screening.detail.summary')} />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">{t('screening.columns.status')}</dt>
                  <dd className="mt-1"><ScreeningStatusBadge status={s.status} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('screening.detail.applicant')}</dt>
                  <dd className="mt-1">
                    <Link to={`/applicants/${s.applicantId}`} className="text-brand-600 hover:underline font-mono text-xs" dir="ltr">
                      {s.applicantCode}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('screening.columns.created')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(s.createdAt, locale)}</dd>
                </div>
                {s.decision !== null && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('screening.columns.decided')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(s.decision.decidedAt, locale)}</dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      {decide !== null && (
        <DecideDialog open onClose={() => setDecide(null)} outcome={decide} screeningId={s.id} version={s.version} />
      )}
    </PageContainer>
  );
};
