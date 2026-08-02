// Record an odometer reading (§4.3): ONE reading that closes the open period and opens the
// next — km and the closing reading are server-derived, so this form asks for nothing derived.
// The SERVER's expected reading shows live as the hint (H2's fate); a reading below it will be
// refused by FR-2 with the correction flow as the only way past. Optional driver slots record
// who took the car out.
import { useEffect, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../shared/lib/format';
import { useExpectedReading, useRecordOdometer } from '../api/fleet-queries';
import { VehicleSelect } from './VehicleSelect';
import { OptionalEmployeeField } from './OptionalEmployeeField';

const today = (): string => new Date().toISOString().slice(0, 10);

export const RecordOdometerDialog = ({
  open,
  onClose,
  initialVehicleId = '',
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-selected vehicle (e.g. arriving filtered from the vehicle profile). */
  initialVehicleId?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [vehicleId, setVehicleId] = useState(initialVehicleId);
  const [reading, setReading] = useState('');
  const [date, setDate] = useState(today());
  const [driver1, setDriver1] = useState('');
  const [driver2, setDriver2] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setVehicleId(initialVehicleId);
      setReading('');
      setDate(today());
      setDriver1('');
      setDriver2('');
      setNotes('');
    }
  }, [open, initialVehicleId]);

  const expected = useExpectedReading(vehicleId, open && vehicleId !== '');
  const record = useRecordOdometer();

  const readingNumber = Number(reading);
  const complete =
    vehicleId !== '' && date !== '' && reading !== '' && Number.isInteger(readingNumber);

  const submit = async (): Promise<void> => {
    await record.mutateAsync({
      vehicleId,
      date: new Date(date),
      reading: readingNumber,
      driver1EmployeeId: driver1 === '' ? null : driver1,
      driver2EmployeeId: driver2 === '' ? null : driver2,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    toast.success(t('fleet.odometer.recorded'));
    onClose();
  };

  const expectedHint =
    expected.data === undefined
      ? undefined
      : expected.data.expectedReading === null
        ? t('fleet.odometer.firstReadingHint')
        : t('fleet.odometer.expectedHint', {
            km: formatNumber(expected.data.expectedReading, locale),
          });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.odometer.record')}
      description={t('fleet.odometer.recordHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={record.isPending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.odometer.fields.vehicle')} required>
          <VehicleSelect value={vehicleId} onChange={setVehicleId} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.odometer.fields.reading')} required hint={expectedHint}>
            <Input
              type="number"
              min={0}
              step={1}
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('fleet.odometer.fields.date')} required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('fleet.odometer.fields.driver1')}>
          <OptionalEmployeeField value={driver1} onChange={setDriver1} />
        </Field>
        <Field label={t('fleet.odometer.fields.driver2')}>
          <OptionalEmployeeField value={driver2} onChange={setDriver2} />
        </Field>
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
