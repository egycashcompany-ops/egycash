// Where this candidate stands in the pipeline, shown beside the breadcrumb.
//
// TWO DIFFERENT FACTS, AND THEY ARE NOT THE SAME ONE. `current` is where the CANDIDATE is — the
// furthest stage that still has open work, as the server derives it. `viewing` is the stage this
// SCREEN is about, which is a fact about how you navigated, not about them.
//
// The bar used to be given one prop and every page passed its own name, so opening a candidate
// from the interview queue drew them at «interview» even when an offer was already out. A
// recruiter reading that bar was being told something false about the person in front of them.
//
// Now the bar shows their real position and marks the stage you are standing on, so «where are
// they» and «what am I looking at» are both answerable and never confused for each other. When the
// two coincide — the common case — the marker simply lands on the current step and says so once.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RECRUITMENT_STAGE_KINDS, type RecruitmentStageKind } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { CheckIcon } from '../../../../shared/ui/icons';

export const RecruitmentStepBar = ({
  current,
  viewing,
  links = {},
  details = {},
}: {
  /**
   * The candidate's real stage. `null` while it is still loading, or once they have left the
   * pipeline — in both cases the bar falls back to the viewed stage rather than claiming a
   * position it does not know.
   */
  current: RecruitmentStageKind | null;
  /** The stage this screen is about. Always known: it is which page you are on. */
  viewing: RecruitmentStageKind;
  /** Where each step leads — the candidate's own record in that stage. A step without one is plain. */
  links?: Partial<Record<RecruitmentStageKind, string>>;
  /** Which round of a multi-round stage (the interview / evaluation the candidate is in). */
  details?: Partial<Record<RecruitmentStageKind, string>>;
}): JSX.Element => {
  const t = useT();
  const standing = current ?? viewing;
  const currentIndex = RECRUITMENT_STAGE_KINDS.indexOf(standing);
  const viewingIndex = RECRUITMENT_STAGE_KINDS.indexOf(viewing);
  const elsewhere = viewingIndex !== currentIndex;

  return (
    <nav aria-label={t('recruitment.step.aria')} className="flex items-center gap-1 overflow-x-auto">
      <ol className="flex items-center gap-1">
        {RECRUITMENT_STAGE_KINDS.map((kind, i) => {
          const done = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isViewing = i === viewingIndex;
          // «المقابلة · المقابلة الثانية» — the stage, and which round of it.
          const detail = details[kind];
          const label =
            detail === undefined || detail === ''
              ? t(`recruitment.step.${kind}`)
              : `${t(`recruitment.step.${kind}`)} · ${detail}`;
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
              <Step
                to={isViewing ? undefined : links[kind]}
                aria-current={isCurrent ? 'step' : undefined}
                title={
                  isViewing && elsewhere
                    ? `${label} — ${t('recruitment.step.viewing')}`
                    : label
                }
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full text-xs font-medium transition-colors',
                  isCurrent
                    ? 'bg-brand-600 px-2.5 py-1 text-white'
                    : done
                      ? 'text-brand-600 dark:text-brand-400'
                      : 'text-slate-400 dark:text-slate-600',
                  // The stage you are STANDING on, when it is not where they stand. A ring rather
                  // than a colour: colour already means progress here, and a second meaning on the
                  // same channel is how a legend becomes necessary.
                  isViewing && elsewhere && 'px-2.5 py-1 ring-2 ring-inset ring-brand-400',
                  !isViewing && links[kind] !== undefined &&
                    'cursor-pointer hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
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
                {/* The current step names itself always; the stage you are on names itself too when
                    it is somewhere else, because that is the whole thing this bar had to say. */}
                <span className={isCurrent || (isViewing && elsewhere) ? '' : 'sr-only sm:not-sr-only'}>
                  {label}
                </span>
                {isViewing && elsewhere && (
                  <span className="sr-only">{t('recruitment.step.viewing')}</span>
                )}
              </Step>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

/** A step: a link to the candidate's record in that stage when there is one, else plain text. */
const Step = ({
  to,
  children,
  ...rest
}: {
  to: string | undefined;
  children: ReactNode;
  className: string;
  title: string;
  'aria-current': 'step' | undefined;
}): JSX.Element =>
  to === undefined ? (
    <span {...rest}>{children}</span>
  ) : (
    <Link to={to} {...rest}>
      {children}
    </Link>
  );
