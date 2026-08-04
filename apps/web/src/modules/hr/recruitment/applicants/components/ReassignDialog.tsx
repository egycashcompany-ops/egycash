// RW2 — reassign a live candidate's Position and/or Branch. Deliberately its own dialog with a
// mandatory reason, never a field on the edit form: a routine data correction must not be able to
// move someone to another branch.
//
// Selecting a seat settles the rest (the server completes department/branch from the position), so
// the form offers the seat first and the bare branch as the fallback for candidates with no seat yet.
import { useEffect, useState } from 'react';
import {
  MAX_PAGE_SIZE,
  type ApplicantDto,
  type Locale,
  type PlacementChangeSource,
  type PlacementDto,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import { useBranchOptions } from '../../../../organization/shared/references';
import { useJobPositions } from '../../../../organization/job-positions/job-position-queries';
import { useJobTitles } from '../../../../organization/job-titles/job-title-queries';
import { useReassignApplicant } from '../api/applicant-queries';

export const ReassignDialog = ({
  applicant,
  open,
  onClose,
  /** RW5 — pre-fill from a stage recommendation, and record where the move came from. */
  prefill,
  source,
  sourceRef,
}: {
  applicant: ApplicantDto;
  open: boolean;
  onClose: () => void;
  prefill?: PlacementDto | null;
  /**
   * Which stage made the call. Kept separate from `sourceRef.entityType` because the two are not
   * the same vocabulary — an offer's record is a `jobOffer` but its placement source is `offer` —
   * and deriving one from the other by cast is how a move ends up filed under the wrong stage.
   */
  source?: PlacementChangeSource;
  sourceRef?: { entityType: string; entityId: string };
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const reassign = useReassignApplicant(applicant.id);

  const [jobPositionId, setJobPositionId] = useState('');
  const [jobTitleId, setJobTitleId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  // Re-seed whenever the dialog opens, so a recommendation pre-fills and a manual open resets.
  useEffect(() => {
    if (!open) return;
    const from = prefill ?? applicant.placement;
    setJobPositionId(from.jobPositionId ?? '');
    setJobTitleId(from.jobTitleId ?? '');
    setBranchId(from.branchId ?? '');
    setReason('');
    setNote('');
  }, [open, prefill, applicant.placement]);

  const { data: branches } = useBranchOptions(open);
  const { data: positions } = useJobPositions({ pageSize: MAX_PAGE_SIZE, status: 'active' });
  const { data: titles } = useJobTitles({ pageSize: MAX_PAGE_SIZE });

  const submit = async (): Promise<void> => {
    if (reason.trim() === '') {
      toast.error(t('applicants.reassign.reasonRequired'));
      return;
    }
    try {
      await reassign.mutateAsync({
        placement: {
          jobPositionId: jobPositionId === '' ? null : jobPositionId,
          jobTitleId: jobTitleId === '' ? null : jobTitleId,
          // The server completes department/section from the seat; a bare branch stands alone.
          departmentId: null,
          sectionId: null,
          branchId: branchId === '' ? null : branchId,
        },
        reason: reason.trim(),
        source: source ?? 'manual',
        ...(sourceRef === undefined ? {} : { sourceRef }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        version: applicant.version,
      });
      toast.success(t('applicants.reassign.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('applicants.reassign.title')}
      description={t('applicants.reassign.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={reassign.isPending} disabled={reason.trim() === ''} onClick={() => void submit()}>
            {t('applicants.reassign.confirm')}
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

        <Field label={t('bulk.reason.title')} hint={t('applicants.reassign.reasonHint')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <Field label={t('applicants.reassign.note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
