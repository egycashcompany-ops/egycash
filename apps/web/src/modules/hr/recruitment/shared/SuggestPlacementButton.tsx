// "اقتراح وظيفة وفرع" — the one action that moves a candidate to a position and a branch.
//
// There were three ways to reach this function and they had drifted into three different sentences:
// a button on the applicant page ("إعادة التعيين"), an advisory "اقتراح وظيفة" that wrote a wish on
// the stage record without moving anyone, and this one. On the applicant screen two of them sat side
// by side reading as near-synonyms in Arabic, which is the bug the owner reported — the duplicate was
// not a stray render, it was a second concept.
//
// So the function is a component now, the way the applicant picker is: one definition, one label, one
// permission, one dialog, and every screen imports it. Adding a stage never means adding a button.
//
// The move itself is an ordinary audited reassignment — mandatory reason, optimistic-concurrency
// version, and an entry in `placementHistory` — because a suggestion that changes the candidate's
// placement immediately IS a reassignment. `source` is what tells the history which stage made the
// call; it is deliberately not derived from `sourceRef.entityType`, whose vocabulary differs (an
// offer's record is a `jobOffer` but its placement source is `offer`).
import { useState } from 'react';
import { type ApplicantDto, type PlacementChangeSource } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { Button } from '../../../../shared/ui/Button';
import { ReassignDialog } from '../applicants/components/ReassignDialog';

export const SuggestPlacementButton = ({
  applicant,
  source,
  sourceRef,
}: {
  applicant: ApplicantDto;
  /** Which stage made the call; the applicant record itself is `manual`. */
  source: PlacementChangeSource;
  /** The stage record the move points back to. Absent on the applicant record. */
  sourceRef?: { entityType: string; entityId: string };
}): JSX.Element => {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Can permission="applicant.reassign">
      <>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t('recommendation.suggest')}
        </Button>
        <ReassignDialog
          applicant={applicant}
          open={open}
          onClose={() => setOpen(false)}
          source={source}
          {...(sourceRef === undefined ? {} : { sourceRef })}
        />
      </>
    </Can>
  );
};
