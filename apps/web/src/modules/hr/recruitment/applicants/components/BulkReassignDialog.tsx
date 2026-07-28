// RW17 — one placement applied to a whole selection. Deliberately separate from the single-
// candidate dialog: this one carries no per-candidate context, and the server still checks the
// editing window per candidate, so an ineligible one fails as that item alone.
import { useState } from 'react';
import { type Locale, type PlacementDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import { useBranchOptions } from '../../../../organization/shared/references';
import { useJobPositions } from '../../../../organization/job-positions/job-position-queries';

export const BulkReassignDialog = ({
  open,
  count,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (placement: PlacementDto, reason: string) => Promise<void>;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [jobPositionId, setJobPositionId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');

  const { data: branches } = useBranchOptions(open);
  const { data: positions } = useJobPositions({ pageSize: 200, status: 'active' });

  const submit = async (): Promise<void> => {
    if (reason.trim() === '') {
      toast.error(t('applicants.reassign.reasonRequired'));
      return;
    }
    try {
      await onSubmit(
        {
          jobPositionId: jobPositionId === '' ? null : jobPositionId,
          jobTitleId: null,
          departmentId: null,
          sectionId: null,
          branchId: branchId === '' ? null : branchId,
        },
        reason.trim(),
      );
      setJobPositionId('');
      setBranchId('');
      setReason('');
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('applicants.reassign.selected')}
      description={t('applicants.reassign.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={pending}
            disabled={reason.trim() === '' || count === 0}
            onClick={() => void submit()}
          >
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
      </div>
    </Dialog>
  );
};
