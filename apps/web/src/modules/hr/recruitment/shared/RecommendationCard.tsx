// RW5 — the placement a stage suggests for a candidate, the action that applies it, and the record
// of every time it moved.
//
// One card serves every stage, and the differences between them are props rather than copies:
//
//   • Interview and Evaluation STORE an advisory recommendation on their own record, so they pass
//     `recommendation` and get the add/edit/clear controls.
//   • Screening, Job Offer and the applicant record store nothing of their own. They omit it and
//     get the suggest action alone — which is the whole feature there.
//
// Suggesting applies the move immediately: "Suggest" opens the ordinary reassign dialog, so it is
// still an audited change with a mandatory reason, and it still lands in `placementHistory`. That
// history is why nothing needs to be carried forward by hand — every later stage reads the
// candidate's current placement, so the last suggestion IS what the next stage sees.
import { useState } from 'react';
import {
  type ApplicantDto,
  type Locale,
  type PlacementChangeDto,
  type PlacementChangeSource,
  type PlacementDto,
  type PlacementLabelDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { ActorById, useDirectoryPage } from '../../../../platform/directory';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { formatDateTime } from '../../../../shared/lib/format';
import { ReassignDialog } from '../applicants/components/ReassignDialog';
import { RecommendationDialog, type RecommendationInput } from './RecommendationDialog';

/** A stage that keeps its own advisory recommendation (RW5). Omitted by stages that do not. */
export interface StageRecommendation {
  placement: PlacementDto | null;
  note: string | null;
  /** The stage record's version — the recommendation is written on that record. */
  version: number;
  /** Who may record one: the panel's grant on interviews, the phase's on evaluations (RW7). */
  editPermission: string;
  pending: boolean;
  onSave: (input: RecommendationInput) => Promise<unknown>;
}

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
  recommendation,
}: {
  /** Null while the candidate is still loading — the card simply waits. */
  applicant: ApplicantDto | null;
  /** The candidate's CURRENT placement, so the card can show both sides (RW4a). */
  currentLabel: PlacementLabelDto;
  /** Which stage a move made here comes from; the applicant record itself is `manual`. */
  source: PlacementChangeSource;
  /** The stage record a move made here points back to. Absent on the applicant record. */
  sourceRef?: { entityType: string; entityId: string };
  recommendation?: StageRecommendation;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [applyOpen, setApplyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const history = applicant?.placementHistory ?? [];
  const last = history[history.length - 1];
  // The actor names for the attribution line AND every row of the history, resolved in one batch.
  useDirectoryPage(history.map((entry) => entry.by));

  const current = describe(currentLabel);
  // The stage's stored recommendation pre-fills the dialog where there is one; elsewhere the
  // candidate's own placement does, so suggesting starts from where they actually stand.
  const prefill = recommendation?.placement ?? null;

  return (
    <Card>
      <CardHeader
        title={t('recommendation.title')}
        actions={
          <div className="flex items-center gap-2">
            {recommendation !== undefined && (
              <Can permission={recommendation.editPermission}>
                <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                  {recommendation.placement === null ? t('recommendation.add') : t('recommendation.edit')}
                </Button>
              </Can>
            )}
            {applicant !== null && (
              <Can permission="applicant.reassign">
                <Button size="sm" variant="secondary" onClick={() => setApplyOpen(true)}>
                  {t('recommendation.suggest')}
                </Button>
              </Can>
            )}
          </div>
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

        {recommendation !== undefined && recommendation.placement !== null && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('recommendation.body')}</p>
        )}
        {recommendation?.note !== undefined && recommendation.note !== null && recommendation.note !== '' && (
          <p className="mt-1 text-sm">{recommendation.note}</p>
        )}

        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('recommendation.history.title')}
          </p>
          <History entries={history} />
        </div>
      </CardBody>

      {applicant !== null && (
        <ReassignDialog
          applicant={applicant}
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          prefill={prefill}
          source={source}
          {...(sourceRef === undefined ? {} : { sourceRef })}
        />
      )}

      {recommendation !== undefined && (
        <RecommendationDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          current={recommendation.placement}
          currentNote={recommendation.note}
          version={recommendation.version}
          pending={recommendation.pending}
          onSubmit={recommendation.onSave}
        />
      )}
    </Card>
  );
};
