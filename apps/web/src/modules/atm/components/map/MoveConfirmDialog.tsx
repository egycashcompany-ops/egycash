// «تأكيد تحريك الموقع» (docs/12-planning/atm-map-zones.md DM-18, §8.8): a located pin moved more
// than 1 km needs a reason — the likely error is a slip of the mouse at a low zoom, and the server
// refuses the move without one. The dialog shows how far and which zone it leaves and enters.
import { useEffect, useId, useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Textarea } from '../../../../shared/ui/form';

export const MoveConfirmDialog = ({
  open,
  km,
  from,
  to,
  saving,
  onBack,
  onConfirm,
}: {
  open: boolean;
  /** Already formatted, one decimal. */
  km: string;
  from: string;
  to: string;
  saving: boolean;
  onBack: () => void;
  onConfirm: (reason: string) => void;
}): JSX.Element => {
  const t = useT();
  const id = useId();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setTried(false);
    }
  }, [open]);
  const missing = reason.trim() === '';
  return (
    <Dialog
      open={open}
      onClose={onBack}
      title={t('atm.map.move.dialogTitle')}
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onBack}>
            {t('atm.map.move.back')}
          </Button>
          <Button
            loading={saving}
            onClick={() => {
              setTried(true);
              if (!missing) onConfirm(reason.trim());
            }}
          >
            {t('atm.map.move.ok')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700 dark:text-slate-200">
        <p>{t('atm.map.move.distance', { km })}</p>
        <p>{t('atm.map.move.zoneChange', { from, to })}</p>
        <Field
          label={t('atm.map.move.reason')}
          htmlFor={id}
          required
          error={tried && missing ? t('atm.map.move.reasonRequired') : undefined}
        >
          <Textarea
            id={id}
            value={reason}
            maxLength={300}
            rows={3}
            error={tried && missing}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
};
