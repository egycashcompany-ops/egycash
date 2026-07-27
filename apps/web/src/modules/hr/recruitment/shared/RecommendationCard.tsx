// RW5 — a stage's advisory placement recommendation, and the two actions around it.
//
// A recommendation never moves the candidate by itself: "Apply" opens the ordinary reassign
// dialog pre-filled, so accepting one is still an audited reassignment with a reason. The
// recommendation itself stays on the stage record forever, accepted or not.
//
// The card renders even with nothing recorded, because recording one is the point: without that
// empty state a panel would have no way to make a recommendation at all.
import { useState } from 'react';
import { type ApplicantDto, type PlacementDto, type PlacementLabelDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { ReassignDialog } from '../applicants/components/ReassignDialog';
import { RecommendationDialog, type RecommendationInput } from './RecommendationDialog';

export const RecommendationCard = ({
  applicant,
  recommendedPlacement,
  recommendationNote,
  currentLabel,
  sourceRef,
  version,
  editPermission,
  pending,
  onSave,
}: {
  /** Null while the candidate is still loading — the card simply waits. */
  applicant: ApplicantDto | null;
  recommendedPlacement: PlacementDto | null;
  recommendationNote: string | null;
  /** The candidate's CURRENT placement, so the card can show both sides (RW4a). */
  currentLabel: PlacementLabelDto;
  sourceRef: { entityType: 'interview' | 'evaluation'; entityId: string };
  /** The stage record's version — the recommendation is written on that record. */
  version: number;
  /** Who may record one: the panel's grant on interviews, the phase's on evaluations (RW7). */
  editPermission: string;
  pending: boolean;
  onSave: (input: RecommendationInput) => Promise<unknown>;
}): JSX.Element => {
  const t = useT();
  const [applyOpen, setApplyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const current = [currentLabel.position, currentLabel.branch].filter((v) => v !== null).join(' · ');

  return (
    <Card>
      <CardHeader
        title={t('recommendation.title')}
        actions={
          <div className="flex items-center gap-2">
            <Can permission={editPermission}>
              <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                {recommendedPlacement === null ? t('recommendation.add') : t('recommendation.edit')}
              </Button>
            </Can>
            {applicant !== null && recommendedPlacement !== null && (
              <Can permission="applicant.reassign">
                <Button size="sm" variant="secondary" onClick={() => setApplyOpen(true)}>
                  {t('recommendation.apply')}
                </Button>
              </Can>
            )}
          </div>
        }
      />
      <CardBody>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {recommendedPlacement === null ? t('recommendation.empty') : t('recommendation.body')}
        </p>
        {recommendationNote !== null && recommendationNote !== '' && (
          <p className="mt-2 text-sm">{recommendationNote}</p>
        )}
        {current !== '' && (
          <p className="mt-2 text-xs text-slate-500">
            {t('recommendation.current').replace('{current}', current)}
          </p>
        )}
      </CardBody>

      {applicant !== null && (
        <ReassignDialog
          applicant={applicant}
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          prefill={recommendedPlacement}
          sourceRef={sourceRef}
        />
      )}

      <RecommendationDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        current={recommendedPlacement}
        currentNote={recommendationNote}
        version={version}
        pending={pending}
        onSubmit={onSave}
      />
    </Card>
  );
};
