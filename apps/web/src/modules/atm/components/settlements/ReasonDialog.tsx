// The reason prompt for «إعادة إلى المسودة» and «إلغاء السطر» (§9.3, §6.5 S19/S20): one required
// line of text, at most 300 characters (`AtmLineReasonSchema`). A dialog you fill in, so a click
// outside does not throw the reason away; Escape and the × still close it.
import { useEffect, useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Textarea } from '../../../../shared/ui/form';

export const REASON_MAX = 300;

export const ReasonDialog = ({
  open,
  title,
  confirmLabel,
  danger = false,
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** The server's refusal, in the reader's words. */
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const trimmed = reason.trim();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={trimmed === ''}
            onClick={() => onConfirm(trimmed)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field
        label={t('atm.plan.reason.label')}
        htmlFor="settlement-reason"
        required
        error={error ?? undefined}
      >
        <Textarea
          id="settlement-reason"
          rows={3}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </Dialog>
  );
};
