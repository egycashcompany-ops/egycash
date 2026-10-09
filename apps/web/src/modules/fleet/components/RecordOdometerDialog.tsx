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
import { Input, Textarea } from '../../../shared/ui/form';
import { SwapIcon } from '../../../shared/ui/icons';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import {
  useExpectedReading,
  useRecordOdometer,
  useAllVehicles,
  useMaintenanceVisits,
  useRosterDay,
} from '../api/fleet-queries';
import { resolveCarriedVehicleCode } from '../lib/vehicle-code-options';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { OptionalDriverField } from './OptionalDriverField';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { DATE_ICON, DesignField, LOOK, MONO, boxTone, carBoxClass } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { FILTER_ICON } from './FilterWithIcon';
import { ODOMETER_DRIVER_BOX, ODOMETER_NOTE_BOX, ODOMETER_SWAP_BUTTON } from './OdometerFormParts';

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

  // «لو فيه هات مفيش هات من شاشه الصيانه … السواق اللى ودها الصيانه لو مفيش هنا او هنا سيبها
  // فاضيه»: with nobody on the roster for the car that day, the driver who took it to the workshop
  // that day — checked in that day, else checked out that day. Neither: the slots stay empty.
  const rosterSettled = !can('fleetRoster.view') || (roster.isFetched && !roster.isPlaceholderData);
  const rosterHasDriver =
    rosterRow !== null &&
    (rosterRow.driver1EmployeeId !== null || rosterRow.driver2EmployeeId !== null);
  const askWorkshop =
    open &&
    can('fleetMaintenance.view') &&
    vehicleId !== '' &&
    date !== '' &&
    rosterSettled &&
    !rosterHasDriver;
  const visitsIn = useMaintenanceVisits({ vehicleId, from: date, to: date }, askWorkshop);
  const visitsOut = useMaintenanceVisits({ vehicleId, outFrom: date, outTo: date }, askWorkshop);
  const workshopDriver = useMemo(() => {
    if (!askWorkshop || visitsIn.isPlaceholderData || visitsOut.isPlaceholderData) return null;
    const checkedIn = visitsIn.data?.items.find((v) => v.driverInEmployeeId !== null);
    if (checkedIn !== undefined) return checkedIn.driverInEmployeeId;
    const checkedOut = visitsOut.data?.items.find((v) => v.driverOutEmployeeId !== null);
    return checkedOut?.driverOutEmployeeId ?? null;
  }, [
    askWorkshop,
    visitsIn.data,
    visitsIn.isPlaceholderData,
    visitsOut.data,
    visitsOut.isPlaceholderData,
  ]);
  useEffect(() => {
    if (workshopDriver === null) return;
    setDriver1((prev) => prev || workshopDriver);
  }, [workshopDriver]);

  const readingNumber = Number(reading);
  const readingGiven = reading !== '' && Number.isInteger(readingNumber);
  // Save stays pressable: pressing it with any of these empty names them and turns their boxes red
  // (`useRequiredFields`). The reading is one of them only on a day that has not passed, as its
  // star says.
  const required = useRequiredFields(
    [
      { key: 'vehicle', label: t('fleet.odometer.fields.vehicle'), ok: vehicleId !== '' },
      {
        key: 'reading',
        label: t('fleet.odometer.fields.reading'),
        ok: readingGiven || dayHasPassed,
      },
      { key: 'date', label: t('fleet.odometer.fields.date'), ok: date !== '' },
    ],
    open,
  );

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

  // ADVICE, NOT A REFUSAL — the warning channel `Field` had: the save goes through either way.
  const readingAdvice: { warning?: string } =
    dayHasPassed && !readingGiven
      ? { warning: t('fleet.odometer.recordingWithoutReading') }
      : derivedKm === 0
        ? { warning: t('fleet.odometer.sameAsPrevious') }
        : {};

  // «حسن الui … بالفورم بتاعت التسجيل والتعديل»: the vehicle form's design — its panel, sections
  // and boxes — around the same fields, rules and required marks as before.
  const box = boxTone(LOOK.add);
  // A number reads left to right; held at the box's right edge, clear of the «!» a refused box
  // draws at its left — as the vehicle form's code box is.
  const numberBox = cn(box, MONO, 'text-right');
  // A date's text starts at the box's left, where a refused box draws its «!».
  const dateBox = cn(box, MONO, DATE_ICON.add, 'cursor-pointer !pl-10');
  const vehicleMissing = required.isMissing('vehicle');

  return (
    // A FORM, so a stray click does not throw it away — «لو دوست في اى حته الموديل ميتقفلش غير
    // لما ادوس على الاكس». The design's backdrop has no click of its own; the ✕, «إلغاء» and
    // Escape close it.
    <DesignDialog
      open={open}
      onClose={onClose}
      title={t('fleet.odometer.record')}
      subtitle={t('fleet.odometer.recordHint')}
      icon={PATH.trend}
      panelProps={{ 'data-odometer-form': 'record' }}
      footer={
        <>
          <DesignSave
            data-odometer-save="true"
            busy={record.isPending}
            onClick={required.guard(submit)}
          />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
      <DesignSection title={t('fleet.odometer.form.sections.reading')} icon={PATH.truck}>
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <DesignField
              label={t('fleet.odometer.fields.vehicle')}
              required
              missing={required.isMissing('vehicle')}
            >
              <div
                {...(vehicleMissing ? { 'data-car-missing': 'true' } : {})}
                className={cn(
                  carBoxClass(false),
                  // Empty when Save was pressed: the design's rose frame and glow, and the box's
                  // ✕ and chevron step inward to leave the far end to the «!».
                  '[&[data-car-missing]_input]:!border-rose-500/70 [&[data-car-missing]_input]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)]',
                  '[&[data-car-missing]_input]:!pe-28 [&[data-car-missing]_.end-2]:!end-10',
                )}
              >
                <VehicleCodeCombobox
                  value={vehicleId}
                  onChange={(id) => {
                    setVehicleId(id);
                    setPickedCode('');
                  }}
                  anyStatus
                  // A carried-in code is named from the first paint, while it is being resolved.
                  pendingCode={pickedCode}
                  ariaLabel={t('fleet.odometer.fields.vehicle')}
                  placeholder={t('fleet.odometer.vehiclePlaceholder')}
                  emptyText={t('fleet.odometer.vehicleNotFound')}
                />
              </div>
            </DesignField>
          </div>
          {/* A READING EQUAL TO THE LAST ONE IS ALLOWED, AND WARNED ABOUT.

              FR-2 refuses a reading BELOW the previous one — `input.reading < floor` throws — so
              an equal one passes, and it should: a vehicle that did not move all day really did
              read the same twice. But it is also exactly what a double-press of «تسجيل قراءة»
              produces, and that writes a second row with `km = 0` that nothing on the screen
              explains. Observed on a real stack while walking a car through its cycle.

              So it warns rather than refuses — an `error` says the save will be refused, a
              `warning` says the value is probably not what was meant and the save goes through
              anyway. Refusing would make a legitimate standing day unrecordable to stop a slip. */}
          <div className="space-y-2">
            <DesignField
              label={t('fleet.odometer.fields.reading')}
              required={!dayHasPassed}
              missing={required.isMissing('reading')}
              hint={
                readingAdvice.warning !== undefined
                  ? undefined
                  : dayHasPassed
                    ? t('fleet.odometer.readingOptionalHint')
                    : expectedHint
              }
            >
              <Input
                rule="integer"
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                dir="ltr"
                tone={numberBox}
              />
            </DesignField>
            {readingAdvice.warning !== undefined && (
              <p
                data-field-warning="true"
                className="text-[13px] font-semibold text-amber-600 dark:text-amber-400"
              >
                {readingAdvice.warning}
              </p>
            )}
          </div>
          <DesignField
            label={t('fleet.odometer.fields.date')}
            required
            missing={required.isMissing('date')}
          >
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              tone={dateBox}
            />
          </DesignField>
          <div className="md:col-span-2">
            <DesignField
              label={t('fleet.odometer.columns.km')}
              hint={t('fleet.odometer.kmDerivedHint')}
            >
              <p
                className={cn(
                  'flex items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3 text-[15px] font-bold tabular-nums text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233]/50 dark:text-slate-200',
                  MONO,
                )}
              >
                {derivedKm === null ? (
                  <span className="text-slate-400">—</span>
                ) : derivedKm < 0 ? (
                  // FR-2 refuses a reading below the previous one; saying so here spares the
                  // operator a round-trip, and the server stays the authority that refuses it.
                  <span className="text-red-600 dark:text-red-400">
                    {t('fleet.odometer.kmBelowPrevious')}
                  </span>
                ) : (
                  t('fleet.odometer.kmValue', { km: formatNumber(derivedKm, locale) })
                )}
              </p>
            </DesignField>
          </div>
        </div>
      </DesignSection>

      {/* Named by their SHIFT, in the same words the table uses. The two slots are not
          interchangeable — slot 1 is the morning, slot 2 the evening — and the generic
          "السائق الأول/الثاني" the roster screens use leaves the operator to guess which is
          which at the one moment it is being decided. */}
      <DesignSection title={t('fleet.odometer.columns.drivers')} icon={FILTER_ICON.person}>
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <DesignField label={t('fleet.odometer.columns.driver1')}>
            <div className={ODOMETER_DRIVER_BOX}>
              <OptionalDriverField value={driver1} onChange={setDriver1} />
            </div>
          </DesignField>
          {/* «زرار ابدل بين اتنين سواقيين»: the morning driver becomes the evening one and back. */}
          <div className="flex justify-center md:pb-0.5">
            <button
              type="button"
              data-odometer-swap-drivers="true"
              disabled={driver1 === '' && driver2 === ''}
              onClick={() => {
                setDriver1(driver2);
                setDriver2(driver1);
              }}
              className={ODOMETER_SWAP_BUTTON}
            >
              <SwapIcon className="h-4 w-4 rotate-90 md:rotate-0" />
              {t('fleet.odometer.swapDrivers')}
            </button>
          </div>
          <DesignField label={t('fleet.odometer.columns.driver2')}>
            <div className={ODOMETER_DRIVER_BOX}>
              <OptionalDriverField value={driver2} onChange={setDriver2} />
            </div>
          </DesignField>
        </div>
      </DesignSection>

      <DesignSection title={t('fleet.attendance.fields.notes')} icon={PATH.edit}>
        <Textarea
          rows={2}
          aria-label={t('fleet.attendance.fields.notes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={ODOMETER_NOTE_BOX}
        />
      </DesignSection>
    </DesignDialog>
  );
};
