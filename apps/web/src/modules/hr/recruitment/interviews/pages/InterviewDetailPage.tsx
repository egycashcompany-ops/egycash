// One interview round, laid out for the person running it.
//
//   • The CANDIDATE first — a hero with their photo, age, education, city and phone, then the
//     brief: personal facts, education, experience and every paper on file (CV, ID card, …), so
//     the interviewer knows what to ask.
//   • The DECISION lives in the evaluation, on the page — recommendation, rating, notes, and
//     «Approve» / «Reject» at the bottom of it. There are no approve/reject buttons in the header
//     any more, and starting a round no longer throws the evaluation form open: it waits on the
//     page until the interview is over.
//   • A DECISION-ONLY stage (the second interview) has no evaluation at all: approve or reject,
//     with a note.
//
// Rounds are not scheduled any more — they are STARTED. Panel changes and cancelling stay quiet, in the header.
import { useState, type ReactNode } from 'react';
import { type InterviewDecision, type Locale } from '@ecms/contracts';
import { Navigate, useParams } from 'react-router-dom';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Button } from '../../../../../shared/ui/Button';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { cn } from '../../../../../shared/lib/cn';
import { formatBusinessDateTime, formatDateTime, localized } from '../../../../../shared/lib/format';
import { CalendarIcon, CheckIcon, CloseIcon, PlayIcon, UsersIcon } from '../../../../../shared/ui/icons';
import { PanelList } from '../components/PanelList';
import { UserName } from '../components/UserName';
import { ReassignPanelDialog } from '../components/ReassignPanelDialog';
import { CancelInterviewDialog } from '../components/CancelInterviewDialog';
import { DecideInterviewDialog } from '../components/DecideInterviewDialog';
import { SkipInterviewerDialog } from '../components/SkipInterviewerDialog';
import { DISPLAY, DocumentWall, FactBento, RoomHero, SHEET } from '../components/InterviewRoom';
import { ProposedRole } from '../components/ProposedRole';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { InterviewEvaluationPanel } from '../components/InterviewEvaluationPanel';
import { QuickDecidePanel } from '../components/QuickDecide';
import { ApplicantLifecycleActions } from '../../applicants/components/ApplicantLifecycleActions';
import { useApplicant } from '../../applicants/api/applicant-queries';
import { MoveToOfferButton } from '../../applicants/components/MoveToOfferButton';
import { CandidateTimeline } from '../../timeline/components/CandidateTimeline';
import { ApplicantStepBar } from '../../shared/ApplicantStepBar';
import {
  useInterview,
  useInterviewStages,
  useStartInterview,
  useStartScheduledInterview,
} from '../api/interview-queries';

const SideCard = ({ title, icon, children }: { title: string; icon: JSX.Element; children: ReactNode }): JSX.Element => (
  <div className={cn(SHEET, 'p-5')}>
    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
      <span className="text-brand-500">{icon}</span> {title}
    </h3>
    {children}
  </div>
);

export const InterviewDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const me = useAppSelector((state) => state.auth.me);
  const can = useCan();
  const { id = '' } = useParams();
  const { data: iv, isLoading, isError, error, refetch } = useInterview(id);
  const { data: stages } = useInterviewStages();
  const startScheduled = useStartScheduledInterview(id);
  const startNow = useStartInterview();
  const { data: candidate } = useApplicant(iv?.applicantId ?? '');

  const [reassignOpen, setReassignOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOutcome, setEditOutcome] = useState<InterviewDecision | null>(null);
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

  const stage = (stages ?? []).find((s) => s.id === iv.stageId);
  const decisionOnly = (stage?.mode ?? (iv.stageOrder >= 2 ? 'decisionOnly' : 'evaluation')) === 'decisionOnly';
  // The second interview has no page: it is decided on its card in the stage's board.
  if (decisionOnly) return <Navigate to={`/interviews/stage/${iv.stageId}`} replace />;
  const isLive = iv.status === 'scheduled' || iv.status === 'inProgress';
  const open = isLive || iv.status === 'waiting';
  const mine = me === null ? null : (iv.panel.find((p) => p.interviewerId === me.id) ?? null);
  const canEvaluate = isLive && mine !== null && can('interview.evaluate');
  const canDecide = can('interview.decide');
  const startable = iv.status === 'waiting' || iv.status === 'scheduled';

  // Starting only starts. The evaluation is on the page, filled in when the interview is over.
  const start = async (): Promise<void> => {
    try {
      if (iv.status === 'scheduled') await startScheduled.mutateAsync({ version: iv.version });
      else await startNow.mutateAsync({ applicantId: iv.applicantId, stageId: iv.stageId, interviewerIds: [] });
    } catch {
      // surfaced globally
    }
  };

  const decisionCard =
    iv.decision === null ? null : (
      <div className={cn(SHEET, 'p-6')}>
        <div className="flex items-center justify-between gap-4">
          <span
            className={cn(
              DISPLAY,
              'inline-flex -rotate-3 items-center gap-2 rounded-lg border-2 px-3 py-1 text-2xl font-black',
              iv.decision.outcome === 'passed'
                ? 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
                : 'border-rose-600 text-rose-600 dark:border-rose-400 dark:text-rose-400',
            )}
          >
            {iv.decision.outcome === 'passed' ? <CheckIcon className="h-6 w-6" /> : <CloseIcon className="h-6 w-6" />}
            {iv.decision.outcome === 'passed' ? t('interviews.eval.approved') : t('interviews.eval.rejected')}
          </span>
          <p className="text-end text-xs text-slate-500">
            {formatDateTime(iv.decision.decidedAt, locale)}
            {iv.decision.decidedBy !== null && (
              <span className="block font-semibold text-slate-700 dark:text-slate-200">
                <UserName id={iv.decision.decidedBy} />
              </span>
            )}
          </p>
        </div>
        {iv.decision.notes !== null && iv.decision.notes !== '' && (
          <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            {iv.decision.notes}
          </p>
        )}
        <Can permission="interview.decide">
          <Button
            size="sm"
            variant="ghost"
            className="mt-3"
            onClick={() => setEditOutcome(iv.outcome === 'passed' ? 'failed' : 'passed')}
          >
            {t('interviews.actions.editDecision')}
          </Button>
        </Can>
      </div>
    );

  return (
    <PageContainer>
      <PageHeader
        title={localized(iv.stageName, locale)}
        aside={<ApplicantStepBar applicantId={iv.applicantId} viewing="interview" />}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.interviews'), to: '/interviews' },
          { label: localized(iv.stageName, locale), to: `/interviews/stage/${iv.stageId}` },
          { label: iv.applicantName },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {isLive && !decisionOnly && (
              <Can permission="interview.edit">
                                <Button size="sm" variant="ghost" onClick={() => setReassignOpen(true)}>{t('interviews.actions.reassign')}</Button>
              </Can>
            )}
            {isLive && (
              <Can permission="interview.cancel">
                <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>{t('interviews.actions.cancel')}</Button>
              </Can>
            )}
            <MoveToOfferButton applicantId={iv.applicantId} />
            <ApplicantLifecycleActions applicantId={iv.applicantId} showWithdrawnHint />
          </div>
        }
      />

      <div className="space-y-6">
        <RoomHero
          interview={iv}
          applicant={candidate}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            {candidate === undefined ? (
              <div className={cn(SHEET, 'grid place-items-center p-12')}>
                <Spinner />
              </div>
            ) : (
              <>
                <FactBento applicant={candidate} />
                <ProposedRole applicant={candidate} currentLabel={candidate.placementLabel} interviewId={iv.id} />
                <DocumentWall applicantId={candidate.id} />
              </>
            )}
          </div>

          <div className="space-y-6 lg:col-span-2">
            <div className="space-y-6 lg:sticky lg:top-4">
              {decisionCard}

              {/* Decision-only stage: approve / reject with a note — nothing else. */}
              {open && decisionOnly && (
                <QuickDecidePanel
                  applicantId={iv.applicantId}
                  applicantName={iv.applicantName}
                  stageId={iv.stageId}
                  canDecide={canDecide}
                />
              )}

              {/* Full stage, not started: one clear call to action. */}
              {!decisionOnly && startable && (
                <div className={cn(SHEET, 'overflow-hidden')}>
                  <div aria-hidden className="h-1 bg-brand-600" />
                  <div className="p-6 text-center">
                    <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-600 ring-8 ring-brand-50/50 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-950/30">
                      <PlayIcon className="h-6 w-6" />
                    </span>
                    <p className={cn(DISPLAY, 'mt-4 text-xl font-extrabold text-slate-900 dark:text-slate-50')}>{t('interviews.page.readyTitle')}</p>
                    <p className="mt-1 text-sm text-slate-500">{t('interviews.page.readyBody')}</p>
                    <Can permission="interview.create">
                      <Button
                        className="mt-5 w-full"
                        leftIcon={<PlayIcon className="h-4 w-4" />}
                        loading={startNow.isPending || startScheduled.isPending}
                        onClick={() => void start()}
                      >
                        {t('interviews.actions.start')}
                      </Button>
                    </Can>
                  </div>
                </div>
              )}

              {/* Full stage, running: the evaluation — where the round is decided. */}
              {!decisionOnly && iv.status === 'inProgress' && (canEvaluate || canDecide) && (
                <InterviewEvaluationPanel
                  key={`${iv.id}-${mine?.submittedAt ?? 'new'}`}
                  interview={iv}
                  mine={mine}
                  canEvaluate={canEvaluate}
                  canDecide={canDecide}
                />
              )}

              <SideCard title={t('interviews.detail.summary')} icon={<CalendarIcon className="h-4 w-4" />}>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">{t('interviews.columns.scheduled')}</dt>
                    <dd className="text-end font-medium text-slate-700 dark:text-slate-200">{formatBusinessDateTime(iv.scheduledAt, locale)}</dd>
                  </div>
                  {iv.startedAt !== null && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">{t('interviews.detail.startedAt')}</dt>
                      <dd className="text-end font-medium text-slate-700 dark:text-slate-200">
                        {formatBusinessDateTime(iv.startedAt, locale)}
                        {iv.startedBy !== null && (
                          <span className="block text-xs font-normal text-slate-400"><UserName id={iv.startedBy} /></span>
                        )}
                      </dd>
                    </div>
                  )}
                  {iv.location !== null && iv.location !== '' && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">{t('interviews.detail.location')}</dt>
                      <dd className="text-end font-medium text-slate-700 dark:text-slate-200">{iv.location}</dd>
                    </div>
                  )}
                  {iv.rescheduleCount > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">{t('interviews.detail.rescheduled')}</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">{iv.rescheduleCount}×</dd>
                    </div>
                  )}
                  {iv.notes !== null && iv.notes !== '' && (
                    <div>
                      <dt className="text-slate-400">{t('interviews.schedule.notes')}</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{iv.notes}</dd>
                    </div>
                  )}
                  {iv.cancelledReason !== null && (
                    <div>
                      <dt className="text-slate-400">{t('interviews.cancel.reason')}</dt>
                      <dd className="mt-1 text-slate-700 dark:text-slate-200">{iv.cancelledReason}</dd>
                    </div>
                  )}
                </dl>
              </SideCard>

              {!decisionOnly && iv.panel.length > 0 && (
                <SideCard title={t('interviews.panel.title')} icon={<UsersIcon className="h-4 w-4" />}>
                  <PanelList
                    panel={iv.panel}
                    canSkip={isLive && can('interview.edit')}
                    onSkip={(interviewerId) => setSkipTarget(interviewerId)}
                  />
                </SideCard>
              )}
            </div>
          </div>
        </div>

        {/* THE recruitment history (I5) — every stage writes here, every screen reads here. */}
        <CandidateTimeline applicantId={iv.applicantId} />
      </div>

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
      {editOutcome !== null && (
        <DecideInterviewDialog
          open
          edit
          onClose={() => setEditOutcome(null)}
          interviewId={iv.id}
          outcome={editOutcome}
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
