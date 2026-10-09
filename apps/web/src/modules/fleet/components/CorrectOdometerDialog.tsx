// The correction flow (owner FL-4 point 1) — the ONLY way past FR-2's monotonic guard, behind
// its own `fleetOdometer.correct` grant and fully audited server-side. The dialog says what a
// correction really does: a shared reading lives on TWO rows, so the server rewrites the
// neighbour atomically and refuses anything that would break the chain's order. Only changed
// fields are sent; version rides along.
import { useEffect, useState } from 'react';
import { type CorrectFleetOdometer, type FleetOdometerLogDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Input, Textarea } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { SwapIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { useCorrectOdometer } from '../api/fleet-queries';
import { OptionalDriverField } from './OptionalDriverField';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { DATE_ICON, DesignField, LOOK, MONO, boxTone } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { FILTER_ICON } from './FilterWithIcon';
import { ODOMETER_DRIVER_BOX, ODOMETER_NOTE_BOX, ODOMETER_SWAP_BUTTON } from './OdometerFormParts';

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
  // «اسمحلى اعدل اسم السواق»: the two drivers are corrected here too.
  const [driver1, setDriver1] = useState('');
  const [driver2, setDriver2] = useState('');
  useEffect(() => {
    if (open && log !== null) {
      // A day recorded WITHOUT a reading has none to correct: the box starts empty and stays shut.
      setOutReading(log.outReading === null ? '' : String(log.outReading));
      setInReading(log.inReading === null ? '' : String(log.inReading));
      setDate(log.date.slice(0, 10));
      setNotes(log.notes ?? '');
      setDriver1(log.driver1EmployeeId ?? '');
      setDriver2(log.driver2EmployeeId ?? '');
    }
  }, [open, log]);

  const correct = useCorrectOdometer();
  // A day recorded without a reading: the server refuses any reading on it («record the reading for
  // that date instead»), and its date and note are corrected like any other row's.
  const noReading = log?.outReading === null;
  // The opening reading cannot be emptied. Pressing «تصحيح القراءة» with it blank used to leave it
  // unchanged without a word; now it is named, and its box turns red (`useRequiredFields`).
  const required = useRequiredFields(
    [
      {
        key: 'outReading',
        label: t('fleet.odometer.columns.outReading'),
        ok: noReading || (outReading !== '' && Number.isInteger(Number(outReading))),
      },
    ],
    open,
  );

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
    if (driver1 !== (log.driver1EmployeeId ?? '')) {
      body.driver1EmployeeId = driver1 === '' ? null : driver1;
    }
    if (driver2 !== (log.driver2EmployeeId ?? '')) {
      body.driver2EmployeeId = driver2 === '' ? null : driver2;
    }

    await correct.mutateAsync({ id: log.id, body });
    toast.success(t('fleet.odometer.corrected'));
    onClose();
  };

  // «حسن الui … بالفورم بتاعت التسجيل والتعديل»: the vehicle form's design around the same
  // fields, rules and required mark as before.
  const box = boxTone(LOOK.add);
  // A number reads left to right; held at the box's right edge, clear of the «!» a refused box
  // draws at its left. A box that cannot be corrected here reads as shut.
  const numberBox = cn(box, MONO, 'text-right disabled:cursor-not-allowed disabled:opacity-50');
  // A date's text starts at the box's left, where a refused box draws its «!».
  const dateBox = cn(box, MONO, DATE_ICON.add, 'cursor-pointer !pl-10');

  return (
    // A form: the design's backdrop has no click of its own — the ✕, «إلغاء» and Escape close it.
    <DesignDialog
      open={open}
      onClose={onClose}
      title={t('fleet.odometer.correct')}
      subtitle={t('fleet.odometer.correctHint')}
      icon={PATH.edit}
      panelProps={{ 'data-odometer-form': 'correct' }}
      footer={
        <>
          <DesignSave
            data-odometer-correct-save="true"
            label={t('fleet.odometer.correct')}
            busy={correct.isPending}
            onClick={required.guard(submit)}
          />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
      <DesignSection title={t('fleet.odometer.form.sections.reading')} icon={PATH.trend}>
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          <DesignField
            label={t('fleet.odometer.columns.outReading')}
            required={!noReading}
            missing={required.isMissing('outReading')}
          >
            <Input
              rule="integer"
              value={outReading}
              onChange={(e) => setOutReading(e.target.value)}
              disabled={noReading}
              dir="ltr"
              tone={numberBox}
            />
          </DesignField>
          <DesignField
            label={t('fleet.odometer.columns.inReading')}
            hint={log?.inReading === null ? t('fleet.odometer.openPeriodHint') : undefined}
          >
            <Input
              rule="integer"
              value={inReading}
              onChange={(e) => setInReading(e.target.value)}
              disabled={log?.inReading === null}
              dir="ltr"
              tone={numberBox}
            />
          </DesignField>
          <DesignField label={t('fleet.odometer.fields.date')}>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              tone={dateBox}
            />
          </DesignField>
          <DesignField label={t('fleet.attendance.fields.notes')}>
            <Textarea
              rows={2}
              aria-label={t('fleet.attendance.fields.notes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={ODOMETER_NOTE_BOX}
            />
          </DesignField>
        </div>
      </DesignSection>

      <DesignSection title={t('fleet.odometer.columns.drivers')} icon={FILTER_ICON.person}>
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          <DesignField label={t('fleet.odometer.columns.driver1')}>
            <div className={ODOMETER_DRIVER_BOX}>
              <OptionalDriverField value={driver1} onChange={setDriver1} />
            </div>
          </DesignField>
          <DesignField label={t('fleet.odometer.columns.driver2')}>
            <div className={ODOMETER_DRIVER_BOX}>
              <OptionalDriverField value={driver2} onChange={setDriver2} />
            </div>
          </DesignField>
          <div className="flex justify-center md:col-span-2">
            <button
              type="button"
              data-odometer-correct-swap="true"
              disabled={driver1 === '' && driver2 === ''}
              onClick={() => {
                setDriver1(driver2);
                setDriver2(driver1);
              }}
              className={ODOMETER_SWAP_BUTTON}
            >
              <SwapIcon className="h-4 w-4" />
              {t('fleet.odometer.swapDrivers')}
            </button>
          </div>
        </div>
      </DesignSection>
    </DesignDialog>
  );
};
