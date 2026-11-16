// THE renderer for a candidate's recruitment history (I5). There is one history, so there is one
// component that draws it: the recruitment screens feed it from the timeline endpoint, and the
// Electronic Employee File feeds it from the `recruitmentTimeline` its own response already
// carries. Neither derives entries — both render the same facts, the same way.
//
// EVERY ENTRY ANSWERS FOUR QUESTIONS, because answering three of them made the history unreadable:
//
//   WHO   — the name, through the same directory card as everywhere else; «النظام» for the acts
//           nobody chose (a queue row opened by a decision, an offer expired by the sweep) and
//           «المتقدّم» for what the candidate did through the portal. The actor used to be drawn
//           from `actorName`, which no recruitment writer ever set, so EVERY entry rendered without
//           one. It is read from `actorUserId` now and falls back to `actorName` for an account
//           that is gone.
//   WHAT  — the event, and WHAT IT SAID: the outcome of a decision, the reason behind it, the
//           version of a paper that replaced another, the seat before and after a change.
//   WHEN  — date and time.
//   WHICH — the round or the phase BY NAME. "«فُتح التقييم» twice at the same minute" was never a
//           duplicate: it was the security check and the medical check, which open together, drawn
//           without the one word that told them apart.
//
// Superseded entries STAY VISIBLE, flagged: a return to an earlier stage retires an attempt, it
// never erases it.
import { type LocalizedString, type Locale, type RecruitmentTimelineEntryDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { ActorById, ActorLink, useDirectoryPage } from '../../../../../platform/directory';
import { useAppSelector } from '../../../../../store';
import { formatDateTime } from '../../../../../shared/lib/format';

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const localizedOf = (value: unknown, locale: Locale): string | null => {
  if (typeof value !== 'object' || value === null) return null;
  const text = (value as Partial<LocalizedString>)[locale] ?? (value as Partial<LocalizedString>).ar;
  return str(text);
};

/**
 * A status in the reader's own words, or the raw value when nobody has translated it yet.
 *
 * `translate` answers with the KEY when a catalog has no entry, which on a page would read as
 * `timeline.status.somethingNew`. A status the vocabulary has not caught up with should show as
 * itself instead — informative, and visibly missing a translation.
 */
const statusLabel = (t: (key: string) => string, status: string): string => {
  const key = `timeline.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

/** The outcome an entry carries, wherever its writer put it. */
const outcomeOf = (entry: RecruitmentTimelineEntryDto): string | null =>
  str(entry.metadata['outcome']) ?? str(entry.toStatus);

/** «تغيّر الفرع: من X إلى Y» — the before and after a placement change recorded for itself. */
const movedFromTo = (entry: RecruitmentTimelineEntryDto): { from: string; to: string } | null => {
  const from = str(entry.metadata['from']);
  const to = str(entry.metadata['to']);
  return from === null && to === null ? null : { from: from ?? '—', to: to ?? '—' };
};

/**
 * A CORRECTION, shown as one: the decision that was there, and the one that replaced it.
 *
 * Every workflow entry already carries both statuses — the engine travels `from` and `to` with the
 * fact — and until now the renderer showed only the new one, so flipping a screening read exactly
 * like deciding it for the first time. The reason and the actor are on the lines below, which
 * together is the whole of «what changed, why, and who».
 */
const correctedFromTo = (
  entry: RecruitmentTimelineEntryDto,
): { from: string; to: string } | null => {
  const from = str(entry.fromStatus);
  const to = str(entry.toStatus);
  return from === null || to === null || from === to ? null : { from, to };
};

/** Which paper an entry is about, by name where the writer recorded one. */
const subjectOf = (entry: RecruitmentTimelineEntryDto, locale: Locale): string | null =>
  localizedOf(entry.metadata['documentName'], locale) ?? str(entry.metadata['documentKey']);

const versionsOf = (entry: RecruitmentTimelineEntryDto): string | null => {
  const from = num(entry.metadata['fromVersion']);
  const to = num(entry.metadata['toVersion']) ?? num(entry.metadata['fileVersion']);
  if (from !== null && to !== null) return `v${String(from)} → v${String(to)}`;
  return to === null ? null : `v${String(to)}`;
};

export const RecruitmentTimelineList = ({
  entries,
}: {
  entries: RecruitmentTimelineEntryDto[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // One request for everybody this history mentions, rather than one per row.
  useDirectoryPage(entries.map((e) => e.actorUserId));

  return (
    <ol className="relative space-y-4 border-s border-slate-200 ps-4 dark:border-slate-700">
      {entries.map((entry) => {
        const attempt = num(entry.metadata['attempt']);
        const stageName = localizedOf(entry.stage?.name, locale);
        const outcome = outcomeOf(entry);
        const corrected = correctedFromTo(entry);
        const moved = movedFromTo(entry);
        const subject = subjectOf(entry, locale);
        const versions = versionsOf(entry);
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
                {/* WHICH round or phase — «المقابلة الأولى», «الفحص الأمني» — not just «المقابلة». */}
                {stageName === null ? null : (
                  <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
                    {stageName}
                  </span>
                )}
                {/* WHICH paper, for the entries about the candidate's file. */}
                {subject === null ? null : (
                  <span className="text-xs text-slate-500 dark:text-slate-400" dir="auto">
                    · {subject}
                  </span>
                )}
                {attempt !== null && attempt > 1 ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {t('timeline.attempt', { n: attempt })}
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
                <span className="text-slate-300 dark:text-slate-600">·</span>
                {/* WHO. Never nothing: an act with no person behind it says so. */}
                {entry.actorKind === 'system' ? (
                  <span className="font-medium">{t('timeline.actor.system')}</span>
                ) : entry.actorKind === 'candidate' ? (
                  <span className="font-medium">{t('timeline.actor.candidate')}</span>
                ) : entry.actorUserId !== null ? (
                  <ActorById userId={entry.actorUserId} />
                ) : entry.actorName !== '' ? (
                  // The name recorded at write time, for an account that no longer exists.
                  <ActorLink
                    actor={{
                      userId: null,
                      displayName: { ar: entry.actorName, en: entry.actorName },
                      jobTitle: null,
                      avatarFileId: null,
                      deletedAt: null,
                    }}
                  />
                ) : (
                  <span className="font-medium">{t('timeline.actor.system')}</span>
                )}
                {versions === null ? null : (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span dir="ltr">{versions}</span>
                  </>
                )}
              </div>

              {/* WHAT IT SAID — the result of a decision, before its reason. A correction says both
                  halves: a flipped decision must not read like a first one. */}
              {corrected !== null ? (
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {t('timeline.outcome')}:{' '}
                  {t('timeline.movedFromTo', {
                    from: statusLabel(t, corrected.from),
                    to: statusLabel(t, corrected.to),
                  })}
                </p>
              ) : outcome === null ? null : (
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {t('timeline.outcome')}: {statusLabel(t, outcome)}
                </p>
              )}
              {/* A change, as a change: from the old seat to the new one. */}
              {moved === null ? null : (
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-200" dir="auto">
                  {t('timeline.movedFromTo', { from: moved.from, to: moved.to })}
                </p>
              )}
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
