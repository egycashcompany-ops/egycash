// «الوظيفة المقترحة» on the interview page — where the candidate is headed, said large enough to
// interview against, with the one action that changes it and the record of every change.
//
// The same data and the same move as the shared `RecommendationCard` (RW5): the placement shown is
// the candidate's CURRENT one, and changing it is the audited reassign with a mandatory reason.
import { useState } from 'react';
import { type ApplicantDto, type Locale, type PlacementLabelDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { ActorById, useDirectoryPage } from '../../../../../platform/directory';
import { cn } from '../../../../../shared/lib/cn';
import { formatDateTime } from '../../../../../shared/lib/format';
import { BriefcaseIcon, BuildingIcon, ChevronIcon, SitemapIcon } from '../../../../../shared/ui/icons';
import { SuggestPlacementButton } from '../../shared/SuggestPlacementButton';
import { DISPLAY, SHEET } from './InterviewRoom';

const describe = (label: PlacementLabelDto): string =>
  [label.position, label.branch].filter((v) => v !== null).join(' · ');

export const ProposedRole = ({
  applicant,
  currentLabel,
  interviewId,
}: {
  applicant: ApplicantDto;
  currentLabel: PlacementLabelDto;
  interviewId: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [open, setOpen] = useState(false);
  const history = applicant.placementHistory;
  const last = history[history.length - 1];
  useDirectoryPage(history.map((entry) => entry.by));

  const chips = [
    { icon: <BuildingIcon className="h-3.5 w-3.5" />, text: currentLabel.branch },
    { icon: <SitemapIcon className="h-3.5 w-3.5" />, text: currentLabel.department },
  ].filter((c): c is { icon: JSX.Element; text: string } => c.text !== null && c.text !== '');

  return (
    <section className={cn(SHEET, 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
            <BriefcaseIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('recommendation.title')}</p>
            <p className={cn(DISPLAY, 'mt-0.5 text-2xl font-extrabold leading-tight text-slate-900 dark:text-slate-50')}>
              {currentLabel.position ?? t('recommendation.noPosition')}
            </p>
            {chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span
                    key={c.text}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {c.icon} {c.text}
                  </span>
                ))}
              </div>
            )}
            {last !== undefined && (
              <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{t('recommendation.lastChanged')}</span>
                <span>{formatDateTime(last.at, locale)}</span>
                {last.by !== null && (
                  <>
                    <span>·</span>
                    <ActorById userId={last.by} />
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <SuggestPlacementButton applicant={applicant} source="interview" sourceRef={{ entityType: 'interview', entityId: interviewId }} />
      </div>

      {history.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
          >
            {t('recommendation.history.titleCount', { n: history.length })}
            <ChevronIcon className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <ol className="space-y-3 px-5 pb-4">
              {history
                .slice()
                .reverse()
                .map((entry) => (
                  <li key={entry.correlationId} className="border-s-2 border-brand-200 ps-3 text-sm dark:border-brand-900">
                    <p className="text-slate-700 dark:text-slate-200">
                      {describe(entry.fromLabel) === '' ? t('recommendation.history.unset') : describe(entry.fromLabel)}
                      {' ← '}
                      <span className="font-semibold">{describe(entry.toLabel)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {t(`recommendation.source.${entry.source}`)} · {formatDateTime(entry.at, locale)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{entry.reason}</p>
                  </li>
                ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
};
