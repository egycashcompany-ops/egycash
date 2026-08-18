// Record an odometer reading (§4.3): ONE reading that closes the open period and opens the
// next — km and the closing reading are server-derived, so this form asks for nothing derived.
// The SERVER's expected reading shows live as the hint (H2's fate); a reading below it will be
// refused by FR-2 with the correction flow as the only way past. Optional driver slots record
// who took the car out.
import { useEffect, useMemo, useState } from 'react';
import { MAX_PAGE_SIZE, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Combobox } from '../../../shared/ui/Combobox';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../shared/lib/format';
import {
  useExpectedReading,
  useRecordOdometer,
  useRosterDay,
  useVehicles,
} from '../api/fleet-queries';
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
  const can = useCan();

  // The vehicle is picked by CODE and typed into, not scrolled to: a registry runs to hundreds of
  // cars and "150" is what the operator knows the car as. `Combobox` only ever commits a value
  // that IS an option, so a code the registry does not carry cannot be saved.
  const vehicles = useVehicles({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' }, open);
  const byCode = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const v of vehicles.data?.items ?? []) {
      map.set(v.code, { id: v.id, label: `${v.code} — ${v.plateNumber}` });
    }
    return map;
  }, [vehicles.data]);
  const codeOptions = useMemo(() => [...byCode.keys()], [byCode]);
  const codeOf = (id: string): string =>
    [...byCode.entries()].find(([, v]) => v.id === id)?.[0] ?? '';

  // Who the DUTY ROSTER says is on this car that day — the same board the roster screen shows,
  // read through the same hook. It PREFILLS the two slots rather than replacing them: a roster
  // may have no assignment for the day, and the reading records who actually took the car out,
  // which is the operator's answer to give. Reading it needs `fleetRoster.view`; without that the
  // hook is never called and the slots simply start empty.
  const rosterDate = open && can('fleetRoster.view') && vehicleId !== '' ? date : '';
  const roster = useRosterDay(rosterDate);
  const rosterRow = useMemo(
    () => roster.data?.rows.find((row) => row.vehicleId === vehicleId) ?? null,
    [roster.data, vehicleId],
  );
  // Only ever fills EMPTY slots, so a value the user has already chosen is never overwritten by a
  // late-arriving board.
  useEffect(() => {
    if (rosterRow === null) return;
    if (rosterRow.driver1EmployeeId !== null)
      setDriver1((prev) => prev || rosterRow.driver1EmployeeId!);
    if (rosterRow.driver2EmployeeId !== null)
      setDriver2((prev) => prev || rosterRow.driver2EmployeeId!);
  }, [rosterRow]);

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
          <Combobox
            value={codeOf(vehicleId)}
            options={codeOptions}
            onChange={(code) => setVehicleId(byCode.get(code)?.id ?? '')}
            placeholder={t('fleet.odometer.vehiclePlaceholder')}
            emptyText={t('fleet.odometer.vehicleNotFound')}
            clearLabel={t('common.clear')}
          />
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
