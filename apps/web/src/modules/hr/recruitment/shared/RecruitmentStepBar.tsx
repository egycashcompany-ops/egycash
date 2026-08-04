// Where this candidate stands in the pipeline, shown beside the breadcrumb.
//
// The breadcrumb says how you navigated here; it does not say how far along the candidate is. On a
// screening page a recruiter can see they are looking at screening, but not whether the interview
// has happened yet or whether an offer is already out — so they open other screens to find out.
// Six steps, the same six everywhere, answer that at a glance.
//
// The bar reflects the stage the SCREEN is about, which is the stage the candidate is being worked
// through right now. It deliberately does not try to infer completion from records the page has not
// loaded: a step is "done" because it is earlier in a fixed order, which is true by construction and
// needs no extra request.
import { RECRUITMENT_STAGE_KINDS, type RecruitmentStageKind } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { CheckIcon } from '../../../../shared/ui/icons';

export const RecruitmentStepBar = ({ current }: { current: RecruitmentStageKind }): JSX.Element => {
  const t = useT();
  const currentIndex = RECRUITMENT_STAGE_KINDS.indexOf(current);

  return (
    <nav aria-label={t('recruitment.step.aria')} className="flex items-center gap-1 overflow-x-auto">
      <ol className="flex items-center gap-1">
        {RECRUITMENT_STAGE_KINDS.map((kind, i) => {
          const done = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <li key={kind} className="flex items-center gap-1">
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'h-px w-3 shrink-0 sm:w-4',
                    i <= currentIndex ? 'bg-brand-400' : 'bg-slate-200 dark:bg-slate-700',
                  )}
                />
              )}
              <span
                // The current step is the only one that names itself at small sizes; the rest stay
                // dots so the bar fits beside a breadcrumb instead of wrapping onto its own row.
                aria-current={isCurrent ? 'step' : undefined}
                title={t(`recruitment.step.${kind}`)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full text-xs font-medium transition-colors',
                  isCurrent
                    ? 'bg-brand-600 px-2.5 py-1 text-white'
                    : done
                      ? 'text-brand-600 dark:text-brand-400'
                      : 'text-slate-400 dark:text-slate-600',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px]',
                    isCurrent
                      ? 'bg-white/25 text-white'
                      : done
                        ? 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300'
                        : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
                  )}
                >
                  {done ? <CheckIcon className="h-2.5 w-2.5" /> : i + 1}
                </span>
                <span className={isCurrent ? '' : 'sr-only sm:not-sr-only'}>
                  {t(`recruitment.step.${kind}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
