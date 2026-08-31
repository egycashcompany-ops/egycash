// Recruitment's nav-children providers (RW16). Registered once at module load; the sidebar asks
// for them by app route. Every provider reads the SAME counters query, so the sidebar issues one
// request no matter how many stages it renders.
import { registerNavChildrenProvider, type NavChildren } from '../../../../platform/navigation/nav-children';
import { stageOfKind, stagesOfKind, useRecruitmentStageCounts } from './stage-counts-queries';

/** The stage kinds that fan out into children, and the singleton stages that just get a badge. */
const useStages = () => useRecruitmentStageCounts().data?.stages;

// NAMED AS HOOKS BECAUSE THEY ARE ONE. Each reads `useStages`, so each is a React hook and may
// only be called from a component that calls it unconditionally — which `DynamicAppRow` does, and
// which is why this has always been correct at runtime. What it was not is CHECKABLE: named
// `children`/`singleton`/`employees`, `rules-of-hooks` could not tell a hook from a helper and
// reported all three. Naming them for what they are lets the rule verify the contract instead of
// being disabled over it.
const useStageChildren = (kind: 'interview' | 'evaluation'): NavChildren => {
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

const useSingletonStage = (kind: 'applicants' | 'screening' | 'jobOffer'): NavChildren => {
  const stage = stageOfKind(useStages(), kind);
  return { count: stage?.count ?? null, children: [] };
};

/**
 * Employees Ready (A6/RW15) is a recruitment queue that lives under the Employees app, so it needs
 * a CHILD row: without one the page has no entry point anywhere in the shell and is reachable only
 * by typing its URL. The counters endpoint omits the stage entirely when the caller cannot hire,
 * so the row simply does not appear for them.
 */
const useEmployeesReady = (): NavChildren => {
  const stage = stageOfKind(useStages(), 'employeesReady');
  if (stage === undefined) return { count: null, children: [] };
  return {
    count: stage.count,
    children: [
      {
        key: stage.key,
        label: { en: 'Ready to hire', ar: 'جاهزون للتعيين' },
        route: stage.route,
        count: stage.count,
      },
    ],
  };
};

// One named hook per route: a provider registered as an anonymous arrow that calls a hook is the
// same violation in a different shape, and `rules-of-hooks` is right to say so.
const useInterviewChildren = (): NavChildren => useStageChildren('interview');
const useEvaluationChildren = (): NavChildren => useStageChildren('evaluation');
const useApplicantsStage = (): NavChildren => useSingletonStage('applicants');
const useScreeningStage = (): NavChildren => useSingletonStage('screening');
const useJobOfferStage = (): NavChildren => useSingletonStage('jobOffer');

let registered = false;

/** Idempotent — safe to call from module load and from tests. */
export const registerRecruitmentNavProviders = (): void => {
  if (registered) return;
  registered = true;
  registerNavChildrenProvider('/interviews', useInterviewChildren);
  registerNavChildrenProvider('/evaluations', useEvaluationChildren);
  registerNavChildrenProvider('/applicants', useApplicantsStage);
  registerNavChildrenProvider('/screening', useScreeningStage);
  registerNavChildrenProvider('/job-offers', useJobOfferStage);
  registerNavChildrenProvider('/employees', useEmployeesReady);
};
