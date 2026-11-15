// The candidate's journey, drawn from what actually happened to them.
//
// WHY IT WAS REBUILT. The old bar had six fixed steps — applicant, screening, interview, evaluation,
// offer, ready — and decided «done» from position alone. That made it wrong in exactly the cases a
// recruiter cares about: two interview rounds were one step, so «passed the first, waiting for the
// second» could not be shown; three evaluation phases were one step; a REJECTED candidate was drawn
// as if still moving; a hired one fell back to whichever page you were on.
//
// Now every step is a REAL stage: each configured interview round and each evaluation phase is its
// own step, and each step's state comes from this candidate's own record for it —
//   done ✓      the record passed (accepted / passed / approved / offer accepted)
//   rejected ✕  the record failed — and every step after it is greyed out
//   current ●   where the server says the candidate stands now (workflow state)
//   skipped –   a step that was passed over (a phase that did not apply to them)
//   upcoming    not reached yet
// and every step with a record links to it. The step for the page you are on wears a ring.
//
// HOOK SAFETY. This component exists so detail pages do not call these hooks below their loading
// guards (React #310) — keep every hook here, unconditional.
import { useQueries } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import {
  type EvaluationDto,
  type InterviewDto,
  type JobOfferDto,
  type Locale,
  type Paginated,
  type RecruitmentStageKind,
  type ScreeningDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { buildQuery, getPage } from '../../../../shared/lib/api-client';
import { localized } from '../../../../shared/lib/format';
import { CheckIcon, CloseIcon } from '../../../../shared/ui/icons';
import { useWorkflowState } from './useWorkflowMutation';
import { useInterviewStages } from '../interviews/api/interview-queries';
import { useEvaluationPhases } from '../evaluations/api/evaluation-queries';

type StepState = 'done' | 'current' | 'rejected' | 'skipped' | 'upcoming';

interface Step {
  key: string;
  label: string;
  state: StepState;
  to?: string;
}

const recordsOf = <T,>(path: string, applicantId: string) => ({
  queryKey: ['applicant-stage-records', path, applicantId],
  queryFn: (): Promise<Paginated<T>> =>
    getPage<T>(`${path}${buildQuery({ applicantId, includeSuperseded: true, pageSize: 50 })}`),
  enabled: applicantId !== '',
  staleTime: 15_000,
  retry: false,
});

/** The record that speaks for a step: a live one over a superseded one, then the newest. */
const latest = <T extends { createdAt: string; supersededAt: string | null }>(items: readonly T[]): T | undefined =>
  [...items].sort((a, b) => {
    if ((a.supersededAt !== null) !== (b.supersededAt !== null)) return a.supersededAt !== null ? 1 : -1;
    return b.createdAt.localeCompare(a.createdAt);
  })[0];

const isLive = <T extends { supersededAt: string | null }>(r: T | undefined): r is T => r !== undefined && r.supersededAt === null;

export const ApplicantStepBar = ({
  applicantId,
}: {
  applicantId: string;
  /** Kept for the callers; the bar now finds the step you are on from the address. */
  viewing?: RecruitmentStageKind;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { pathname } = useLocation();
  const workflow = useWorkflowState(applicantId);
  const { data: stageCatalog } = useInterviewStages();
  const { data: phaseCatalog } = useEvaluationPhases();
  const [screenings, interviews, evaluations, offers] = useQueries({
    queries: [
      recordsOf<ScreeningDto>('/hr/screenings', applicantId),
      recordsOf<InterviewDto>('/hr/interviews', applicantId),
      recordsOf<EvaluationDto>('/hr/evaluations', applicantId),
      recordsOf<JobOfferDto>('/hr/job-offers', applicantId),
    ],
  });

  const nowKey = workflow?.stage?.key ?? null;
  const nowKind = workflow?.stage?.kind ?? null;
  const applicantStatus = workflow?.applicantStatus ?? 'new';
  const isCurrent = (key: string, kind: RecruitmentStageKind): boolean =>
    nowKey === key || (nowKey === null && nowKind === kind);

  const steps: Step[] = [];

  // 1 — the application itself
  steps.push({
    key: 'applicants',
    label: t('recruitment.step.applicants'),
    state: isCurrent('applicants', 'applicants') ? 'current' : 'done',
    to: `/applicants/${applicantId}`,
  });

  // 2 — screening
  const scr = latest(screenings.data?.items ?? []);
  steps.push({
    key: 'screening',
    label: t('recruitment.step.screening'),
    state: isLive(scr)
      ? scr.status === 'accepted'
        ? 'done'
        : scr.status === 'rejected'
          ? 'rejected'
          : isCurrent('screening', 'screening') ? 'current' : 'upcoming'
      : isCurrent('screening', 'screening') ? 'current' : 'upcoming',
    ...(scr === undefined ? {} : { to: `/screening/${scr.id}` }),
  });

  // 3 — every interview round, in the configured order (plus any retired round they sat)
  const ivItems = interviews.data?.items ?? [];
  const rounds = new Map<string, { order: number; name: string }>();
  for (const s of stageCatalog ?? []) if (s.active) rounds.set(s.id, { order: s.order, name: localized(s.name, locale) });
  for (const r of ivItems) if (!rounds.has(r.stageId)) rounds.set(r.stageId, { order: r.stageOrder, name: localized(r.stageName, locale) });
  for (const [stageId, round] of [...rounds.entries()].sort((a, b) => a[1].order - b[1].order)) {
    const rec = latest(ivItems.filter((r) => r.stageId === stageId && r.status !== 'cancelled'));
    const key = `interview:${stageId}`;
    const state: StepState = isLive(rec)
      ? rec.status === 'completed'
        ? rec.outcome === 'failed' ? 'rejected' : 'done'
        : isCurrent(key, 'interview') ? 'current' : 'upcoming'
      : isCurrent(key, 'interview') ? 'current' : 'upcoming';
    steps.push({ key, label: round.name, state, ...(rec === undefined ? {} : { to: `/interviews/${rec.id}` }) });
  }
  if (rounds.size === 0) {
    steps.push({ key: 'interview', label: t('recruitment.step.interview'), state: nowKind === 'interview' ? 'current' : 'upcoming' });
  }

  // 4 — evaluation phases: every phase for everyone, plus the conditional ones they actually entered
  const evItems = evaluations.data?.items ?? [];
  const phases = new Map<string, { order: number; name: string }>();
  for (const p of phaseCatalog ?? []) {
    if (!p.active) continue;
    const entered = evItems.some((e) => e.phaseId === p.id) || nowKey === `evaluation:${p.id}`;
    if (p.applicability === 'all' || entered) phases.set(p.id, { order: p.order, name: localized(p.name, locale) });
  }
  for (const e of evItems) if (!phases.has(e.phaseId)) phases.set(e.phaseId, { order: e.phaseOrder, name: localized(e.phaseName, locale) });
  for (const [phaseId, phase] of [...phases.entries()].sort((a, b) => a[1].order - b[1].order)) {
    const rec = latest(evItems.filter((e) => e.phaseId === phaseId && e.status !== 'cancelled'));
    const key = `evaluation:${phaseId}`;
    const state: StepState = isLive(rec)
      ? rec.status === 'approved'
        ? 'done'
        : rec.status === 'rejected' ? 'rejected' : isCurrent(key, 'evaluation') ? 'current' : 'upcoming'
      : isCurrent(key, 'evaluation') ? 'current' : 'upcoming';
    steps.push({ key, label: phase.name, state, ...(rec === undefined ? {} : { to: `/evaluations/${rec.id}` }) });
  }
  if (phases.size === 0) {
    steps.push({ key: 'evaluation', label: t('recruitment.step.evaluation'), state: nowKind === 'evaluation' ? 'current' : 'upcoming' });
  }

  // 5 — the offer
  const offer = latest((offers.data?.items ?? []).filter((o) => o.status !== 'superseded'));
  steps.push({
    key: 'jobOffer',
    label: t('recruitment.step.jobOffer'),
    state: isLive(offer)
      ? offer.status === 'accepted'
        ? 'done'
        : offer.status === 'rejected' || offer.status === 'expired' || offer.status === 'withdrawn'
          ? 'rejected'
          : isCurrent('jobOffer', 'jobOffer') ? 'current' : 'upcoming'
      : isCurrent('jobOffer', 'jobOffer') ? 'current' : 'upcoming',
    ...(offer === undefined ? {} : { to: `/job-offers/${offer.id}` }),
  });

  // 6 — ready to hire / hired
  steps.push({
    key: 'employeesReady',
    label: t('recruitment.step.employeesReady'),
    state: applicantStatus === 'hired' ? 'done' : isCurrent('employeesReady', 'employeesReady') ? 'current' : 'upcoming',
  });

  // Close the story. Hired: everything before is done. Rejected / withdrawn: everything after the
  // last thing that happened is greyed. Moving: a step left behind without a record was skipped.
  if (applicantStatus === 'hired') {
    for (const s of steps) if (s.state !== 'rejected') s.state = s.state === 'upcoming' ? 'skipped' : 'done';
    const last = steps[steps.length - 1];
    if (last !== undefined) last.state = 'done';
  } else {
    const anchor = Math.max(
      steps.findIndex((s) => s.state === 'current'),
      steps.findIndex((s) => s.state === 'rejected'),
      steps.reduce((acc, s, i) => (s.state === 'done' ? i : acc), -1),
    );
    steps.forEach((s, i) => {
      if (i < anchor && s.state === 'upcoming') s.state = 'skipped';
    });
    if (applicantStatus === 'rejected' || applicantStatus === 'withdrawn') {
      const stop = steps.findIndex((s) => s.state === 'rejected');
      steps.forEach((s, i) => {
        if ((stop >= 0 && i > stop) || s.state === 'current') s.state = stop >= 0 && i > stop ? 'skipped' : 'rejected';
      });
    }
  }

  return (
    <nav aria-label={t('recruitment.step.aria')} className="max-w-full overflow-x-auto pb-1">
      <ol className="flex items-center gap-1">
        {steps.map((s, i) => {
          const here = s.to !== undefined && pathname === s.to;
          const chip = (
            <span
              title={here ? `${s.label} — ${t('recruitment.step.viewing')}` : s.label}
              aria-current={s.state === 'current' ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pe-3 ps-1 text-xs font-semibold transition',
                s.state === 'current' && 'bg-gradient-to-r from-brand-600 to-indigo-500 text-white shadow-md shadow-brand-500/30',
                s.state === 'done' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
                s.state === 'rejected' && 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
                s.state === 'skipped' && 'text-slate-300 line-through dark:text-slate-600',
                s.state === 'upcoming' && 'text-slate-400 dark:text-slate-500',
                here && 'ring-2 ring-brand-400 ring-offset-1 ring-offset-white dark:ring-offset-slate-950',
                s.to !== undefined && !here && 'hover:brightness-95 hover:underline hover:underline-offset-4',
              )}
            >
              <span
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                  s.state === 'current' && 'bg-white/25',
                  s.state === 'done' && 'bg-emerald-500 text-white',
                  s.state === 'rejected' && 'bg-rose-500 text-white',
                  (s.state === 'upcoming' || s.state === 'skipped') && 'bg-slate-100 dark:bg-slate-800',
                )}
              >
                {s.state === 'done' ? (
                  <CheckIcon className="h-3 w-3" />
                ) : s.state === 'rejected' ? (
                  <CloseIcon className="h-3 w-3" />
                ) : s.state === 'current' ? (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                  </span>
                ) : s.state === 'skipped' ? (
                  '–'
                ) : (
                  i + 1
                )}
              </span>
              {s.label}
            </span>
          );
          return (
            <li key={s.key} className="flex items-center gap-1">
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'h-0.5 w-3 shrink-0 rounded-full sm:w-5',
                    s.state === 'upcoming' || s.state === 'skipped'
                      ? 'bg-slate-200 dark:bg-slate-700'
                      : s.state === 'rejected'
                        ? 'bg-rose-300'
                        : 'bg-emerald-300',
                  )}
                />
              )}
              {s.to !== undefined && !here ? <Link to={s.to}>{chip}</Link> : chip}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
