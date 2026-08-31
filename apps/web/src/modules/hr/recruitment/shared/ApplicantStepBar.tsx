// The step bar for a named applicant, fetching the candidate's standing itself.
//
// WHY THIS COMPONENT EXISTS. Five detail pages needed the candidate's real stage, and each read it
// the same way — a `useWorkflowState(...)` call sitting beside the JSX that used it, which is to
// say BELOW the page's `if (isLoading) return …` guard, because the applicant id it needs only
// exists once the record has loaded.
//
// That is React error #310, exactly: the first render returns early and never reaches the hook,
// the render after the data arrives runs one hook more, and React refuses the mismatch with
// "Rendered more hooks than during the previous render". Minified in production to a number on a
// blank screen — and on every one of those pages it fires on a cold cache, which is every time
// somebody opens a person's file from a queue.
//
// A component boundary is the fix that cannot come back: the hook lives here, where it is called
// unconditionally, and the page renders `<ApplicantStepBar />` in its JSX like any other element.
// A page cannot re-introduce the hazard without re-introducing the hook, and `rules-of-hooks`
// (enabled in eslint.config.js in the same change) now fails the build if one does.
import { type RecruitmentStageKind } from '@ecms/contracts';
import { RecruitmentStepBar } from './RecruitmentStepBar';
import { useWorkflowState } from './useWorkflowMutation';

export const ApplicantStepBar = ({
  applicantId,
  viewing,
}: {
  /** The candidate whose standing the bar draws. */
  applicantId: string;
  /** The stage this screen is about — always known, it is which page you are on. */
  viewing: RecruitmentStageKind;
}): JSX.Element => {
  // `null` while the standing is still loading: the bar falls back to the viewed stage rather
  // than claiming a position it does not know yet.
  const current = useWorkflowState(applicantId)?.stage?.kind ?? null;
  return <RecruitmentStepBar current={current} viewing={viewing} />;
};
