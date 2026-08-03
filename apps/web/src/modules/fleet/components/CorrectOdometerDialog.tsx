// The correction flow (owner FL-4 point 1) — the ONLY way past FR-2's monotonic guard, behind
// its own `fleetOdometer.correct` grant and fully audited server-side. The dialog says what a
// correction really does: a shared reading lives on TWO rows, so the server rewrites the
// neighbour atomically and refuses anything that would break the chain's order. Only changed
// fields are sent; version rides along.
import { useEffect, useState } from 'react';
import { type CorrectFleetOdometer, type FleetOdometerLogDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCorrectOdometer } from '../api/fleet-queries';

export const CorrectOdometerDialog = ({
  open,
  onClose,
  log,
}: {
  open: boolean;
  onClose: () => void;
  log: FleetOdometerLogDto | null;
}): JSX.Element => {
  const t = useT();
  const [outReading, setOutReading] = useState('');
  const [inReading, setInReading] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open && log !== null) {
      setOutReading(String(log.outReading));
      setInReading(log.inReading === null ? '' : String(log.inReading));
      setDate(log.date.slice(0, 10));
      setNotes(log.notes ?? '');
    }
  }, [open, log]);

  const correct = useCorrectOdometer();

  const submit = async (): Promise<void> => {
    if (log === null) return;
    const body: CorrectFleetOdometer = { version: log.version };
    const newOut = Number(outReading);
    if (outReading !== '' && Number.isInteger(newOut) && newOut !== log.outReading) {
      body.outReading = newOut;
    }
    // An emptied closing reading is NOT sent as null (that would ask to reopen the period —
    // the server refuses it for middle rows); it simply stays unchanged.
    const newIn = Number(inReading);
    if (inReading !== '' && Number.isInteger(newIn) && newIn !== log.inReading) {
      body.inReading = newIn;
    }
    if (date !== '' && date !== log.date.slice(0, 10)) body.date = new Date(date);
    const trimmed = notes.trim();
    if (trimmed !== (log.notes ?? '')) body.notes = trimmed === '' ? null : trimmed;

    await correct.mutateAsync({ id: log.id, body });
    toast.success(t('fleet.odometer.corrected'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.odometer.correct')}
      description={t('fleet.odometer.correctHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={correct.isPending} onClick={() => void submit()}>
            {t('fleet.odometer.correct')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('fleet.odometer.columns.outReading')} required>
          <Input
            type="number"
            min={0}
            step={1}
            value={outReading}
            onChange={(e) => setOutReading(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field
          label={t('fleet.odometer.columns.inReading')}
          hint={log?.inReading === null ? t('fleet.odometer.openPeriodHint') : undefined}
        >
          <Input
            type="number"
            min={0}
            step={1}
            value={inReading}
            onChange={(e) => setInReading(e.target.value)}
            disabled={log?.inReading === null}
            dir="ltr"
          />
        </Field>
        <Field label={t('fleet.odometer.fields.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
