// THE renderer for a candidate's recruitment history (I5). There is one history, so there is one
// component that draws it: the recruitment screens feed it from the timeline endpoint, and the
// Electronic Employee File feeds it from the `recruitmentTimeline` its own response already
// carries. Neither derives entries — both render the same facts, the same way.
//
// Superseded entries STAY VISIBLE, flagged: a return to an earlier stage retires an attempt, it
// never erases it.
import { type RecruitmentTimelineEntryDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { ActorLink } from '../../../../../platform/directory';
import { useAppSelector } from '../../../../../store';
import { formatDateTime } from '../../../../../shared/lib/format';

const attemptOf = (entry: RecruitmentTimelineEntryDto): number | null => {
  const value = entry.metadata['attempt'];
  return typeof value === 'number' ? value : null;
};

export const RecruitmentTimelineList = ({
  entries,
}: {
  entries: RecruitmentTimelineEntryDto[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);

  return (
    <ol className="relative space-y-4 border-s border-slate-200 ps-4 dark:border-slate-700">
      {entries.map((entry) => {
        const attempt = attemptOf(entry);
        return (
          <li key={entry.eventId} className="relative">
            <span
              className={`absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-slate-900 ${
                entry.supersededAt === null ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'
              }`}
              aria-hidden
            />
            <div className={entry.supersededAt === null ? '' : 'opacity-60'}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {t(`timeline.type.${entry.type}`)}
                </span>
                {entry.stage?.name !== null && entry.stage?.name !== undefined ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    · {entry.stage.name[locale]}
                  </span>
                ) : null}
                {attempt !== null && attempt > 1 ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {t('timeline.attempt').replace('{n}', String(attempt))}
                  </span>
                ) : null}
                {entry.supersededAt !== null ? (
                  <span
                    title={t('timeline.supersededHint')}
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                  >
                    {t('timeline.superseded')}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{formatDateTime(entry.at, locale)}</span>
                {entry.actorName === '' ? null : (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    {/* The name recorded at write time — the same platform card as everywhere else. */}
                    <ActorLink
                      actor={{
                        userId: entry.actorUserId,
                        displayName: { ar: entry.actorName, en: entry.actorName },
                        jobTitle: null,
                        avatarFileId: null,
                        deletedAt: null,
                      }}
                    />
                  </>
                )}
              </div>
              {entry.note === null ? null : (
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{entry.note}</p>
              )}
              {entry.reason === null ? null : (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {t('timeline.reason')}: {entry.reason}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
