// Recruitment's nav-children providers (RW16). Registered once at module load; the sidebar asks
// for them by app route. Every provider reads the SAME counters query, so the sidebar issues one
// request no matter how many stages it renders.
import { registerNavChildrenProvider, type NavChildren } from '../../../../platform/navigation/nav-children';
import { stageOfKind, stagesOfKind, useRecruitmentStageCounts } from './stage-counts-queries';

/** The stage kinds that fan out into children, and the singleton stages that just get a badge. */
const useStages = () => useRecruitmentStageCounts().data?.stages;

const children = (kind: 'interview' | 'evaluation'): NavChildren => {
  const stages = useStages();
  const rows = stagesOfKind(stages, kind);
  return {
    // The parent shows the whole family's backlog; each child shows its own.
    count: rows.reduce((sum, s) => sum + s.count, 0),
    children: rows.map((s) => ({
      key: s.key,
      label: s.name ?? { en: s.key, ar: s.key },
      route: s.route,
      count: s.count,
    })),
  };
};

const singleton = (kind: 'applicants' | 'screening' | 'jobOffer' | 'employeesReady'): NavChildren => {
  const stage = stageOfKind(useStages(), kind);
  return { count: stage?.count ?? null, children: [] };
};

let registered = false;

/** Idempotent — safe to call from module load and from tests. */
export const registerRecruitmentNavProviders = (): void => {
  if (registered) return;
  registered = true;
  registerNavChildrenProvider('/interviews', () => children('interview'));
  registerNavChildrenProvider('/evaluations', () => children('evaluation'));
  registerNavChildrenProvider('/applicants', () => singleton('applicants'));
  registerNavChildrenProvider('/screening', () => singleton('screening'));
  registerNavChildrenProvider('/job-offers', () => singleton('jobOffer'));
};
