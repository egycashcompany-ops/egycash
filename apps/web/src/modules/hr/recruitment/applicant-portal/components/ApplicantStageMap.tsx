// Where the application stands, drawn as six steps — or as one word.
//
// A REFUSED CANDIDATE GETS THE WORD, NOT THE MAP. Drawing the six steps with a red cross two
// thirds along is showing somebody exactly how far they got before being turned down, and this
// design has no use for that. `stepsToDraw` on the server side makes the same choice; this is the
// half of it a person sees.
import { type ApplicantPortalStep } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';

const ORDER: ApplicantPortalStep[] = [
  'applied',
  'screeningPassed',
  'interview',
  'assessment',
  'jobOffer',
  'hired',
];

export const ApplicantStageMap = ({ step }: { step: ApplicantPortalStep }): JSX.Element => {
  const t = useT();

  if (step === 'rejected') {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {t('hr.applicantPortal.step.rejected')}
        </p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {t('hr.applicantPortal.step.rejectedBody')}
        </p>
      </div>
    );
  }

  const reached = ORDER.indexOf(step);

  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-1">
      {ORDER.map((name, index) => {
        const done = index < reached;
        const here = index === reached;
        return (
          <li key={name} className="flex flex-1 items-center gap-2 sm:flex-col sm:items-stretch">
            <span
              aria-hidden="true"
              className={`h-1.5 rounded-full sm:w-full ${
                done || here
                  ? 'w-1.5 bg-sky-600 dark:bg-sky-400'
                  : 'w-1.5 bg-slate-200 dark:bg-slate-700'
              }`}
            />
            <span
              className={`text-xs sm:mt-1 ${
                here
                  ? 'font-semibold text-sky-700 dark:text-sky-300'
                  : done
                    ? 'text-slate-700 dark:text-slate-300'
                    : 'text-slate-400 dark:text-slate-500'
              }`}
              aria-current={here ? 'step' : undefined}
            >
              {t(`hr.applicantPortal.step.${name}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
};
