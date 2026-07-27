// RW5 — a stage's advisory placement recommendation, and the one action that acts on it.
//
// A recommendation never moves the candidate by itself: "Apply" opens the ordinary reassign
// dialog pre-filled, so accepting one is still an audited reassignment with a reason. The
// recommendation itself stays on the stage record forever, accepted or not.
import { useState } from 'react';
import { type ApplicantDto, type PlacementDto, type PlacementLabelDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { ReassignDialog } from '../applicants/components/ReassignDialog';

export const RecommendationCard = ({
  applicant,
  recommendedPlacement,
  recommendationNote,
  currentLabel,
  sourceRef,
}: {
  /** Null while the candidate is still loading — the card simply waits. */
  applicant: ApplicantDto | null;
  recommendedPlacement: PlacementDto | null;
  recommendationNote: string | null;
  /** The candidate's CURRENT placement, so the card can show both sides (RW4a). */
  currentLabel: PlacementLabelDto;
  sourceRef: { entityType: 'interview' | 'evaluation'; entityId: string };
}): JSX.Element | null => {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (recommendedPlacement === null) return null;

  const current = [currentLabel.position, currentLabel.branch].filter((v) => v !== null).join(' · ');

  return (
    <Card>
      <CardHeader
        title={t('recommendation.title')}
        actions={
          applicant === null ? undefined : (
            <Can permission="applicant.reassign">
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                {t('recommendation.apply')}
              </Button>
            </Can>
          )
        }
      />
      <CardBody>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('recommendation.body')}</p>
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
          open={open}
          onClose={() => setOpen(false)}
          prefill={recommendedPlacement}
          sourceRef={sourceRef}
        />
      )}
    </Card>
  );
};
