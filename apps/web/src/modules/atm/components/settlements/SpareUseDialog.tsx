// «ربط بماكينة» (S-9, DS-27, §6.5 S21): the machine a spare set was later loaded into. It changes no
// count and no Note; it is the record S-9 asks for, and may be corrected (the server audits each).
import { useEffect, useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../shared/ui/form';

export const SpareUseDialog = ({
  open,
  initialCode,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** The machine recorded already, when this is a correction. */
  initialCode: string;
  busy: boolean;
  error: string | null;
  onConfirm: (machineCode: string) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [code, setCode] = useState(initialCode);
  useEffect(() => {
    if (open) setCode(initialCode);
  }, [open, initialCode]);
  const trimmed = code.trim();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('atm.plan.spareUse.title')}
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={trimmed === ''} onClick={() => onConfirm(trimmed)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field
        label={t('atm.plan.spareUse.code')}
        htmlFor="spare-use-code"
        required
        error={error ?? undefined}
      >
        <Input
          id="spare-use-code"
          dir="ltr"
          maxLength={40}
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
    </Dialog>
  );
};
