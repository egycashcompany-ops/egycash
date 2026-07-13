// Replace the interviewer panel WITHOUT touching the schedule. Retained members keep their
// evaluation state; new members start pending; removed members drop off (server semantics).
// Matches ReassignInterviewPanel (interviewerIds min 1, version-checked).
import { useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { UserPicker, type SelectedUser } from './UserPicker';
import { useReassignPanel } from '../api/interview-queries';

export const ReassignPanelDialog = ({
  open,
  onClose,
  interviewId,
  currentInterviewerIds,
  version,
}: {
  open: boolean;
  onClose: () => void;
  interviewId: string;
  currentInterviewerIds: string[];
  version: number;
}): JSX.Element => {
  const t = useT();
  const reassign = useReassignPanel(interviewId);
  // Pre-seed with the current members (label resolved via the directory chip).
  const [panel, setPanel] = useState<SelectedUser[]>(currentInterviewerIds.map((id) => ({ id, label: '' })));

  const submit = async (): Promise<void> => {
    if (panel.length === 0) return;
    try {
      await reassign.mutateAsync({ interviewerIds: panel.map((u) => u.id), version });
      toast.success(t('interviews.panel.reassigned'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('interviews.panel.reassignTitle')}
      description={t('interviews.panel.reassignBody')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={reassign.isPending} disabled={panel.length === 0} onClick={() => void submit()}>
            {t('interviews.panel.reassignSubmit')}
          </Button>
        </>
      }
    >
      <Field label={t('interviews.schedule.panel')} required hint={t('interviews.schedule.panelHint')}>
        <UserPicker value={panel} onChange={setPanel} />
      </Field>
    </Dialog>
  );
};
