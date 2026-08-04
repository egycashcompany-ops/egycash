// RW5 — where a candidate currently sits, the one action that moves them, and the record of every
// time they moved.
//
// One card serves every stage — screening, interview, evaluation, job offer and the applicant record
// itself — and the only differences between them are props: which stage a move made here is filed
// under, and which record it points back to.
//
// There is no stage-local recommendation any more. A stage used to be able to write an advisory
// placement on its own record that moved nobody, which meant two answers to "where is this candidate
// going" and — on the applicant screen — two buttons whose Arabic labels read the same. Suggesting
// now applies the move: `SuggestPlacementButton` opens the ordinary reassign dialog, so it is an
// audited change with a mandatory reason that lands in `placementHistory`. That history is also why
// nothing needs carrying forward by hand — every later stage reads the candidate's current placement,
// so the last suggestion IS what the next stage sees.
import {
  type ApplicantDto,
  type Locale,
  type PlacementChangeDto,
  type PlacementChangeSource,
  type PlacementLabelDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { ActorById, useDirectoryPage } from '../../../../platform/directory';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { formatDateTime } from '../../../../shared/lib/format';
import { SuggestPlacementButton } from './SuggestPlacementButton';

const describe = (label: PlacementLabelDto): string =>
  [label.position, label.branch].filter((v) => v !== null).join(' · ');

/** Every move, newest first — the same list on every stage, read from the candidate. */
const History = ({ entries }: { entries: readonly PlacementChangeDto[] }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  if (entries.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">{t('recommendation.history.empty')}</p>;
  }

  return (
    <ol className="space-y-3">
      {entries
        .slice()
        .reverse()
        .map((entry) => (
          <li
            key={entry.correlationId}
            className="border-s-2 border-slate-100 ps-3 text-sm dark:border-slate-800"
          >
            <p className="text-slate-700 dark:text-slate-200">
              {describe(entry.fromLabel) === '' ? t('recommendation.history.unset') : describe(entry.fromLabel)}
              {' → '}
              {describe(entry.toLabel)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t(`recommendation.source.${entry.source}`)} · {formatDateTime(entry.at, locale)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{entry.reason}</p>
            {entry.note !== null && entry.note !== '' && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{entry.note}</p>
            )}
          </li>
        ))}
    </ol>
  );
};

export const RecommendationCard = ({
  applicant,
  currentLabel,
  source,
  sourceRef,
}: {
  /** Null while the candidate is still loading — the card simply waits. */
  applicant: ApplicantDto | null;
  /** The candidate's CURRENT placement, so the card can show both sides (RW4a). */
  currentLabel: PlacementLabelDto;
  /** Which stage a move made here comes from; the applicant record itself is `manual`. */
  source: PlacementChangeSource;
  /** The stage record a move made here points back to. Absent on the applicant record. */
  sourceRef?: { entityType: string; entityId: string };
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const history = applicant?.placementHistory ?? [];
  const last = history[history.length - 1];
  // The actor names for the attribution line AND every row of the history, resolved in one batch.
  useDirectoryPage(history.map((entry) => entry.by));

  const current = describe(currentLabel);

  return (
    <Card>
      <CardHeader
        title={t('recommendation.title')}
        actions={
          applicant !== null && (
            <SuggestPlacementButton
              applicant={applicant}
              source={source}
              {...(sourceRef === undefined ? {} : { sourceRef })}
            />
          )
        }
      />
      <CardBody>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {current === '' ? t('recommendation.empty') : t('recommendation.current').replace('{current}', current)}
        </p>

        {/* What is shown above is the RESULT of the last move, so the card says which move that
            was. Without it a suggestion looks like a standing fact rather than someone's recent
            decision, and there is no way to tell a fresh call from a stale one. */}
        {last !== undefined && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-slate-500 dark:text-slate-400">
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

        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('recommendation.history.title')}
          </p>
          <History entries={history} />
        </div>
      </CardBody>
    </Card>
  );
};
