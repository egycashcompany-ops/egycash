// Record an odometer reading (§4.3): ONE reading that closes the open period and opens the
// next — km and the closing reading are server-derived, so this form asks for nothing derived.
// The SERVER's expected reading shows live as the hint (H2's fate); a reading below it will be
// refused by FR-2 with the correction flow as the only way past. Optional driver slots record
// who took the car out.
//
// ك.م is SHOWN but never asked for. The legacy did the same arithmetic on submit — `POST
// /cars_log` set the new row's `out_num`, the previous row's `in_num`, and km = the difference —
// so a manual km field would be a second, competing answer to a question the server already
// answers. What the operator loses without it is the SIGHT of the distance they are about to
// record, so the dialog previews it from the server's own expected reading rather than asking.
import { useEffect, useMemo, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../shared/lib/format';
import {
  useExpectedReading,
  useRecordOdometer,
  useAllVehicles,
  useRosterDay,
} from '../api/fleet-queries';
import { resolveCarriedVehicleCode } from '../lib/vehicle-code-options';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { OptionalDriverField } from './OptionalDriverField';

const today = (): string => new Date().toISOString().slice(0, 10);

export const RecordOdometerDialog = ({
  open,
  onClose,
  initialVehicleCode = '',
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Pre-selected vehicle, by CODE (e.g. arriving from a page filtered to one car).
   *
   * A code rather than an id, because the caller no longer holds the registry to look an id up
   * in — and because the code is what it actually knows. The dialog asks the registry for it and
   * takes the id from the answer.
   */
  initialVehicleCode?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [vehicleId, setVehicleId] = useState('');
  // A code carried in from the page's filter, until the registry has turned it into an id. Seeded
  // from the prop, not only from the reset effect, so the first paint already knows it.
  const [pickedCode, setPickedCode] = useState(initialVehicleCode);
  const [reading, setReading] = useState('');
  const [date, setDate] = useState(today());
  const [driver1, setDriver1] = useState('');
  const [driver2, setDriver2] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setVehicleId('');
      setPickedCode(initialVehicleCode);
      setReading('');
      setDate(today());
      setDriver1('');
      setDriver2('');
      setNotes('');
    }
  }, [open, initialVehicleCode]);

  const expected = useExpectedReading(vehicleId, open && vehicleId !== '');
  const record = useRecordOdometer();
  const can = useCan();

  /*
   * MAY THE COUNTER BE LEFT OUT FOR THIS DAY? — the same question the server asks, asked the same
   * way, so the star on the field and the answer from the save cannot disagree.
   *
   * «لا اما يسيبو فاضى ويدله انذار» … «بس اللى هى فاتت». A day that HAS PASSED can be recorded
   * without a counter: whoever drove it is worth keeping, and a number nobody wrote down cannot
   * be invented. Today's reading is the one somebody is standing at the car to take, and
   * tomorrow's has not happened — so those two still require it, and that is the whole rule.
   *
   * IT USED TO ASK THE SERVER FOR THE DAY'S BRACKET and allow this only inside a gap. It no
   * longer has to: a day with no reading is on NO chain, so where the chain happens to end has
   * nothing to say about it — and «has this day passed» is a question the browser answers with no
   * request at all, so the field's star no longer flickers while an answer is in flight.
   *
   * `today()` is UTC, as the date input is and as the server's own midnight is, so the two agree
   * at every hour rather than only outside the small hours.
   */
  const dayHasPassed = date !== '' && date < today();

  // The vehicle is picked by CODE and typed into, from the WHOLE registry — every car on the
  // vehicles screen, any lifecycle status, as this dialog has always offered (`VehicleCodeCombobox`).
  // It used to search the server for a twenty-car shortlist, so clicking the box listed the first
  // twenty codes and nothing past them.
  //
  // A code carried in from the page's filter names a car this dialog has not got an id for. The
  // registry the picker loads is read for it here, once — the same cached list.
  const registry = useAllVehicles({ anyStatus: true }, open && pickedCode !== '');
  useEffect(() => {
    if (pickedCode === '' || vehicleId !== '') return;
    if (registry.data === undefined) return;
    const found = resolveCarriedVehicleCode(registry.data.items, pickedCode);
    // No car carries it: let it go, so the box reads empty rather than holding a code it cannot save.
    if (found === null) setPickedCode('');
    else setVehicleId(found);
  }, [registry.data, pickedCode, vehicleId]);

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
  // The two slots belong to a (vehicle, date) PAIR. Change either and the previous pair's crew is
  // no longer an answer to the question being asked, so it is cleared rather than carried over —
  // otherwise switching from car 150 to car 151 keeps 150's drivers and records them against the
  // wrong car.
  useEffect(() => {
    setDriver1('');
    setDriver2('');
  }, [vehicleId, date]);

  // Fills EMPTY slots only, so a name the operator has already chosen is never overwritten by a
  // late-arriving board. `isPlaceholderData` is the PREVIOUS day's board still on screen while the
  // new one loads; filling from it would write yesterday's crew onto today's reading.
  useEffect(() => {
    if (rosterRow === null || roster.isPlaceholderData) return;
    if (rosterRow.driver1EmployeeId !== null)
      setDriver1((prev) => prev || rosterRow.driver1EmployeeId!);
    if (rosterRow.driver2EmployeeId !== null)
      setDriver2((prev) => prev || rosterRow.driver2EmployeeId!);
  }, [rosterRow, roster.isPlaceholderData]);

  const readingNumber = Number(reading);
  const readingGiven = reading !== '' && Number.isInteger(readingNumber);
  const complete = vehicleId !== '' && date !== '' && (readingGiven || dayHasPassed);

  const submit = async (): Promise<void> => {
    await record.mutateAsync({
      vehicleId,
      date: new Date(date),
      // `null` is «this day ran, and nobody wrote the counter» — allowed only in a gap, and the
      // server says so again on its own bracket rather than trusting this one.
      reading: readingGiven ? readingNumber : null,
      driver1EmployeeId: driver1 === '' ? null : driver1,
      driver2EmployeeId: driver2 === '' ? null : driver2,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    toast.success(t('fleet.odometer.recorded'));
    onClose();
  };

  // The distance this reading will close the open period with — the very subtraction the service
  // performs, over the number the SERVER just gave for the previous reading. A preview, not an
  // input: nothing here is sent, and the server recomputes it on write.
  const previousReading = expected.data?.expectedReading ?? null;
  const derivedKm =
    previousReading === null || reading === '' || !Number.isInteger(readingNumber)
      ? null
      : readingNumber - previousReading;

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
      // A FORM, so a stray click does not throw it away — «لو دوست في اى حته الموديل ميتقفلش غير
      // لما ادوس على الاكس». Escape still closes it.
      dismissOnOutsideClick={false}
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
          <VehicleCodeCombobox
            value={vehicleId}
            onChange={(id) => {
              setVehicleId(id);
              setPickedCode('');
            }}
            anyStatus
            // A carried-in code is named from the first paint, while it is being resolved.
            pendingCode={pickedCode}
            placeholder={t('fleet.odometer.vehiclePlaceholder')}
            emptyText={t('fleet.odometer.vehicleNotFound')}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* A READING EQUAL TO THE LAST ONE IS ALLOWED, AND WARNED ABOUT.
              
              FR-2 refuses a reading BELOW the previous one — `input.reading < floor` throws — so
              an equal one passes, and it should: a vehicle that did not move all day really did
              read the same twice. But it is also exactly what a double-press of «تسجيل قراءة»
              produces, and that writes a second row with `km = 0` that nothing on the screen
              explains. Observed on a real stack while walking a car through its cycle.
              
              So it warns rather than refuses — `Field`'s own distinction: an `error` says the
              save will be refused, a `warning` says the value is probably not what was meant and
              the save goes through anyway. Refusing would make a legitimate standing day
              unrecordable to stop a slip. */}
          <Field
            label={t('fleet.odometer.fields.reading')}
            required={!dayHasPassed}
            hint={dayHasPassed ? t('fleet.odometer.readingOptionalHint') : expectedHint}
            {...(dayHasPassed && !readingGiven
              ? { warning: t('fleet.odometer.recordingWithoutReading') }
              : derivedKm === 0
                ? { warning: t('fleet.odometer.sameAsPrevious') }
                : {})}
          >
            <Input
              rule="integer"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('fleet.odometer.fields.date')} required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('fleet.odometer.columns.km')} hint={t('fleet.odometer.kmDerivedHint')}>
          <p className="text-sm tabular-nums text-slate-700 dark:text-slate-200">
            {derivedKm === null ? (
              <span className="text-slate-400">—</span>
            ) : derivedKm < 0 ? (
              // FR-2 refuses a reading below the previous one; saying so here spares the operator
              // a round-trip, and the server stays the authority that actually refuses it.
              <span className="text-red-600 dark:text-red-400">
                {t('fleet.odometer.kmBelowPrevious')}
              </span>
            ) : (
              t('fleet.odometer.kmValue', { km: formatNumber(derivedKm, locale) })
            )}
          </p>
        </Field>
        {/* Named by their SHIFT, in the same words the table uses. The two slots are not
            interchangeable — slot 1 is the morning, slot 2 the evening — and the generic
            "السائق الأول/الثاني" the roster screens use leaves the operator to guess which is
            which at the one moment it is being decided. */}
        <Field label={t('fleet.odometer.columns.driver1')}>
          <OptionalDriverField value={driver1} onChange={setDriver1} />
        </Field>
        <Field label={t('fleet.odometer.columns.driver2')}>
          <OptionalDriverField value={driver2} onChange={setDriver2} />
        </Field>
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
