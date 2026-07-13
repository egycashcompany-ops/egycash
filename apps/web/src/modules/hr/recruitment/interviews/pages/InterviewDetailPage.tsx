// Interview detail: the panel + evaluations, scheduling read-out, and the full action surface —
// reschedule, reassign panel, skip a no-show, submit your own evaluation (assigned interviewers),
// and pass/fail the round. Every action is permission-gated and version-checked; a decision is
// blocked while any panel member is still pending (server rule, surfaced here).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type InterviewDecision, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { formatDateTime, localized } from '../../../../../shared/lib/format';
import { InterviewStatusBadge } from '../components/InterviewStatusBadge';
import { PanelList } from '../components/PanelList';
import { UserName } from '../components/UserName';
import { RescheduleDialog } from '../components/RescheduleDialog';
import { ReassignPanelDialog } from '../components/ReassignPanelDialog';
import { CancelInterviewDialog } from '../components/CancelInterviewDialog';
import { DecideInterviewDialog } from '../components/DecideInterviewDialog';
import { EvaluateDialog } from '../components/EvaluateDialog';
import { SkipInterviewerDialog } from '../components/SkipInterviewerDialog';
import { useInterview } from '../api/interview-queries';

export const InterviewDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const me = useAppSelector((state) => state.auth.me);
  const can = useCan();
  const { id = '' } = useParams();
  const { data: iv, isLoading, isError, error, refetch } = useInterview(id);

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [evaluateOpen, setEvaluateOpen] = useState(false);
  const [decideOutcome, setDecideOutcome] = useState<InterviewDecision | null>(null);
  const [skipTarget, setSkipTarget] = useState<string | null>(null);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || iv === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const isScheduled = iv.status === 'scheduled';
  const anyPending = iv.panel.some((p) => p.state === 'pending');
  const mine = me === null ? null : iv.panel.find((p) => p.interviewerId === me.id) ?? null;
  const canEvaluate = isScheduled && mine !== null && can('interview.evaluate');

  return (
    <PageContainer>
      <PageHeader
        title={t('interviews.detail.title', { code: iv.applicantCode })}
        description={localized(iv.stageName, locale)}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.interviews'), to: '/interviews' },
          { label: iv.applicantCode },
        ]}
        actions={
          isScheduled ? (
            <div className="flex flex-wrap items-center gap-2">
              {canEvaluate && (
                <Button size="sm" variant="secondary" onClick={() => setEvaluateOpen(true)}>
                  {mine?.state === 'submitted' ? t('interviews.actions.reevaluate') : t('interviews.actions.evaluate')}
                </Button>
              )}
              <Can permission="interview.edit">
                <Button size="sm" variant="ghost" onClick={() => setRescheduleOpen(true)}>{t('interviews.actions.reschedule')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setReassignOpen(true)}>{t('interviews.actions.reassign')}</Button>
              </Can>
              <Can permission="interview.decide">
                <Button size="sm" variant="secondary" disabled={anyPending} onClick={() => setDecideOutcome('passed')}>
                  {t('interviews.actions.pass')}
                </Button>
                <Button size="sm" variant="danger" disabled={anyPending} onClick={() => setDecideOutcome('failed')}>
                  {t('interviews.actions.fail')}
                </Button>
              </Can>
              <Can permission="interview.cancel">
                <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>{t('interviews.actions.cancel')}</Button>
              </Can>
            </div>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/applicants/${iv.applicantId}`} className="font-mono text-sm text-brand-600 hover:underline" dir="ltr">
          {iv.applicantCode}
        </Link>
        <InterviewStatusBadge status={iv.status} outcome={iv.outcome} />
      </div>

      {isScheduled && can('interview.decide') && anyPending && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {t('interviews.decide.blocked')}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('interviews.panel.title')} />
            <CardBody>
              <PanelList
                panel={iv.panel}
                canSkip={isScheduled && can('interview.edit')}
                onSkip={(interviewerId) => setSkipTarget(interviewerId)}
              />
            </CardBody>
          </Card>

          {iv.decision !== null && (
            <Card>
              <CardHeader title={t('interviews.decide.title')} />
              <CardBody>
                <div className="space-y-2 text-sm">
                  <InterviewStatusBadge status={iv.status} outcome={iv.outcome} />
                  {iv.decision.notes !== null && iv.decision.notes !== '' && (
                    <p className="text-slate-600 dark:text-slate-300">{iv.decision.notes}</p>
                  )}
                  <p className="text-xs text-slate-400">
                    {formatDateTime(iv.decision.decidedAt, locale)}
                    {iv.decision.decidedBy !== null && (
                      <>
                        {' · '}
                        <UserName id={iv.decision.decidedBy} />
                      </>
                    )}
                  </p>
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('interviews.detail.summary')} />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">{t('interviews.columns.stage')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{localized(iv.stageName, locale)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('interviews.columns.scheduled')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(iv.scheduledAt, locale)}</dd>
                </div>
                {iv.location !== null && iv.location !== '' && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('interviews.detail.location')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{iv.location}</dd>
                  </div>
                )}
                {iv.rescheduleCount > 0 && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('interviews.detail.rescheduled')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{iv.rescheduleCount}×</dd>
                  </div>
                )}
                {iv.notes !== null && iv.notes !== '' && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('interviews.schedule.notes')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{iv.notes}</dd>
                  </div>
                )}
                {iv.cancelledReason !== null && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('interviews.cancel.reason')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{iv.cancelledReason}</dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      {rescheduleOpen && (
        <RescheduleDialog
          open
          onClose={() => setRescheduleOpen(false)}
          interviewId={iv.id}
          currentScheduledAt={iv.scheduledAt}
          version={iv.version}
        />
      )}
      {reassignOpen && (
        <ReassignPanelDialog
          open
          onClose={() => setReassignOpen(false)}
          interviewId={iv.id}
          currentInterviewerIds={iv.panel.map((p) => p.interviewerId)}
          version={iv.version}
        />
      )}
      {cancelOpen && (
        <CancelInterviewDialog open onClose={() => setCancelOpen(false)} interviewId={iv.id} version={iv.version} />
      )}
      {evaluateOpen && (
        <EvaluateDialog
          open
          onClose={() => setEvaluateOpen(false)}
          interviewId={iv.id}
          version={iv.version}
          existing={mine}
        />
      )}
      {decideOutcome !== null && (
        <DecideInterviewDialog
          open
          onClose={() => setDecideOutcome(null)}
          interviewId={iv.id}
          outcome={decideOutcome}
          version={iv.version}
        />
      )}
      {skipTarget !== null && (
        <SkipInterviewerDialog
          onClose={() => setSkipTarget(null)}
          interviewId={iv.id}
          interviewerId={skipTarget}
          version={iv.version}
        />
      )}
    </PageContainer>
  );
};
