// RW5 — record (or clear) a stage's advisory placement recommendation.
//
// This is DATA on the stage record, not a move: saving it changes nothing about where the
// candidate actually sits. Acting on it is a separate, audited reassignment with its own grant,
// which is why this dialog has no "apply" of its own — the card next to it owns that.
//
// Clearing is a first-class outcome: a panel that changes its mind must be able to withdraw its
// recommendation, so the form's "no position, no branch" state saves `null` rather than refusing.
import { useEffect, useState } from 'react';
import { type Locale, type PlacementDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Select, Textarea } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { useBranchOptions } from '../../../organization/shared/references';
import { useJobPositions } from '../../../organization/job-positions/job-position-queries';
import { useJobTitles } from '../../../organization/job-titles/job-title-queries';

export interface RecommendationInput {
  recommendedPlacement: PlacementDto | null;
  recommendationNote?: string;
  version: number;
}

export const RecommendationDialog = ({
  open,
  onClose,
  current,
  currentNote,
  version,
  pending,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  current: PlacementDto | null;
  currentNote: string | null;
  version: number;
  pending: boolean;
  onSubmit: (input: RecommendationInput) => Promise<unknown>;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const [jobPositionId, setJobPositionId] = useState('');
  const [jobTitleId, setJobTitleId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [note, setNote] = useState('');

  // Re-seed on every open so the form always shows what is actually recorded.
  useEffect(() => {
    if (!open) return;
    setJobPositionId(current?.jobPositionId ?? '');
    setJobTitleId(current?.jobTitleId ?? '');
    setBranchId(current?.branchId ?? '');
    setNote(currentNote ?? '');
  }, [open, current, currentNote]);

  const { data: branches } = useBranchOptions(open);
  const { data: positions } = useJobPositions({ pageSize: 200, status: 'active' });
  const { data: titles } = useJobTitles({ pageSize: 200 });

  const empty = jobPositionId === '' && jobTitleId === '' && branchId === '';

  const save = async (clear: boolean): Promise<void> => {
    try {
      await onSubmit({
        recommendedPlacement: clear
          ? null
          : {
              jobPositionId: jobPositionId === '' ? null : jobPositionId,
              jobTitleId: jobTitleId === '' ? null : jobTitleId,
              // The server completes department/section from the seat, exactly as a reassignment does.
              departmentId: null,
              sectionId: null,
              branchId: branchId === '' ? null : branchId,
            },
        ...(clear || note.trim() === '' ? {} : { recommendationNote: note.trim() }),
        version,
      });
      toast.success(t(clear ? 'recommendation.cleared' : 'recommendation.saved'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('recommendation.edit')}
      description={t('recommendation.editBody')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {current !== null && (
            <Button variant="ghost" loading={pending} onClick={() => void save(true)}>
              {t('recommendation.clear')}
            </Button>
          )}
          <Button loading={pending} disabled={empty} onClick={() => void save(false)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('applicants.reassign.position')} hint={t('applicants.reassign.positionHint')}>
          <Select value={jobPositionId} onChange={(e) => setJobPositionId(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {(positions?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {localized(p.name, locale)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('applicants.reassign.jobTitle')}>
          <Select value={jobTitleId} onChange={(e) => setJobTitleId(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {(titles?.items ?? []).map((jt) => (
              <option key={jt.id} value={jt.id}>
                {localized(jt.name, locale)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('applicants.reassign.branch')}>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {localized(b.name, locale)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('recommendation.note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
