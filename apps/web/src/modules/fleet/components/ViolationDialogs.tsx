// Violation + grievance dialogs (§4.7, FR-9). Two shapes, two forms, one rule: the FRONTEND
// computes no money. A vehicle statement row sends count × unit value and NEVER an amount —
// the server derives it on create and on every factor edit; a driver row records the amount
// as entered and requires a driver profile to exist (FR-11), which the server enforces. Edits
// keep the row's own shape (cross-shape edits are refused server-side) and send only changed
// fields + version; the vehicle is identity on an existing row, so it is not editable. The
// grievance is the ONE per-(vehicle, year) figure — a PUT set/replace, prefilled from the
// rollup row it was opened on.
import { useEffect, useState } from 'react';
import { isUnknownFleetDriver, type FleetViolationDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatMoney } from '../../../shared/lib/format';
import { Dialog } from '../../../shared/ui/Dialog';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useRecordDriverViolation,
  useRecordVehicleViolation,
  useSetGrievance,
  useUpdateViolation,
  useAllVehicles,
} from '../api/fleet-queries';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { CatalogSelect } from './CatalogSelect';
import { RegistryDriverPicker } from './RegistryDriverPicker';
import { pickedDriverId, UNKNOWN_DRIVER } from '../lib/driver-filter-selection';

const currentYear = (): number => new Date().getFullYear();

const isMoney = (value: string): boolean =>
  value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

/** Bulk yearly statement row — year + count + unit value; the amount is the server's. */
export const VehicleViolationDialog = ({
  open,
  onClose,
  violation,
  initialVehicleId = '',
  mode = 'edit',
  onConfirmDelete,
  deleting = false,
}: {
  open: boolean;
  onClose: () => void;
  /** null = record; a `vehicle`-shape row = version-aware edit. */
  violation: FleetViolationDto | null;
  initialVehicleId?: string;
  /**
   * `delete` shows the SAME form, read-only, over a delete button.
   *
   * A bare «are you sure?» asks a reader to confirm something they cannot see. Removing a fine is
   * irreversible and the row it names is one of several on one car in one year, so the thing to
   * confirm is the FINE — its year, its car, its kind, its value, its count and what those come to
   * — not the sentence "this cannot be undone".
   */
  mode?: 'edit' | 'delete';
  onConfirmDelete?: () => void;
  deleting?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [vehicleId, setVehicleId] = useState('');
  const [year, setYear] = useState(String(currentYear()));
  const [violationTypeId, setViolationTypeId] = useState('');
  const [count, setCount] = useState('');
  const [unitValue, setUnitValue] = useState('');
  useEffect(() => {
    if (!open) return;
    setVehicleId(violation?.vehicleId ?? initialVehicleId);
    setYear(String(violation?.year ?? currentYear()));
    setViolationTypeId(violation?.violationTypeId ?? '');
    setCount(violation?.count === null || violation === null ? '' : String(violation.count));
    setUnitValue(
      violation?.unitValue === null || violation === null ? '' : String(violation.unitValue),
    );
  }, [open, violation, initialVehicleId]);

  const record = useRecordVehicleViolation();
  const update = useUpdateViolation();
  const pending = record.isPending || update.isPending;
  const readOnly = mode === 'delete';

  // The car's CODE, which is what a reader recognises — the row carries only its id.
  // The WHOLE registry: a car past the first hundred by code read as «—».
  const vehicles = useAllVehicles({ anyStatus: true });
  const code = (vehicles.data?.items ?? []).find((v) => v.id === vehicleId)?.code ?? '—';

  // What the row comes to. The server owns this arithmetic (count × unitValue) and this mirrors it
  // so the reader sees the consequence of an edit BEFORE committing it — and, on the delete path,
  // exactly how much is about to leave the year's total.
  const money = Number(unitValue);
  const times = Number(count);
  const total = isMoney(unitValue) && Number.isInteger(times) && times >= 1 ? money * times : null;

  // Save stays pressable: pressing it with any of these empty — or a year outside the server's
  // 2000–2100, a count below one — names them and turns their boxes red (`useRequiredFields`).
  const required = useRequiredFields(
    [
      { key: 'vehicle', label: t('fleet.odometer.columns.vehicle'), ok: vehicleId !== '' },
      {
        key: 'year',
        label: t('fleet.violations.fields.year'),
        ok: Number.isInteger(Number(year)) && Number(year) >= 2000 && Number(year) <= 2100,
      },
      { key: 'type', label: t('fleet.violations.fields.type'), ok: violationTypeId !== '' },
      {
        key: 'count',
        label: t('fleet.violations.fields.count'),
        ok: Number.isInteger(Number(count)) && Number(count) >= 1,
      },
      { key: 'unitValue', label: t('fleet.violations.fields.unitValue'), ok: isMoney(unitValue) },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    if (violation === null) {
      await record.mutateAsync({
        vehicleId,
        year: Number(year),
        violationTypeId,
        count: Number(count),
        unitValue: Number(unitValue),
      });
    } else {
      await update.mutateAsync({
        id: violation.id,
        body: {
          version: violation.version,
          ...(violationTypeId !== violation.violationTypeId ? { violationTypeId } : {}),
          ...(Number(count) !== violation.count ? { count: Number(count) } : {}),
          ...(Number(unitValue) !== violation.unitValue ? { unitValue: Number(unitValue) } : {}),
          // Only what CHANGED travels — an update that restates every field would make a no-op
          // edit look like a five-field change in the audit trail.
          ...(vehicleId !== violation.vehicleId ? { vehicleId } : {}),
          ...(Number(year) !== violation.year ? { year: Number(year) } : {}),
        },
      });
    }
    toast.success(t('fleet.violations.saved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={
        readOnly
          ? t('fleet.violations.deleteTitle')
          : violation === null
            ? t('fleet.violations.recordVehicle')
            : t('fleet.violations.edit')
      }
      description={readOnly ? t('fleet.violations.deleteBody') : t('fleet.violations.vehicleHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {readOnly ? (
            <Button variant="danger" loading={deleting} onClick={() => onConfirmDelete?.()}>
              {t('fleet.violations.delete')}
            </Button>
          ) : (
            <Button loading={pending} onClick={required.guard(submit)}>
              {t('common.save')}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={readOnly} className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        {/* THE CAR AND THE YEAR ARE CORRECTABLE, on a filed row as much as on a new one.
            They used to be frozen once filed — the car shown as plain text, the year's box
            disabled — on the argument that moving a fine is a different act from correcting one.
            The commonest correction is exactly those two: a statement arrives naming one plate
            and is keyed against another, or lands in the wrong year, and the only way back was to
            delete the row and re-file it, which throws away the row's history to fix a typo.
            The DELETE path still shows them read-only, because the whole `fieldset` is. */}
        <Field
          label={t('fleet.odometer.columns.vehicle')}
          required
          missing={required.isMissing('vehicle')}
        >
          <VehicleCodeCombobox
            value={vehicleId}
            onChange={setVehicleId}
            anyStatus
            ariaLabel={t('fleet.odometer.columns.vehicle')}
            placeholder={t('fleet.accidents.vehiclePlaceholder')}
          />
          {/* The code stays on the page under the picker, for the reader who came to CONFIRM a
              row rather than change it — and it is what the delete dialog is really asking about. */}
          <p data-violation-code className="mt-1 font-mono text-xs text-slate-500" dir="ltr">
            {code}
          </p>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.violations.fields.year')}
            required
            missing={required.isMissing('year')}
            {...(required.isMissing('year') && year.trim() !== ''
              ? { error: t('fleet.violations.yearRange') }
              : {})}
          >
            <Input
              rule="integer"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field
            label={t('fleet.violations.fields.type')}
            required
            missing={required.isMissing('type')}
          >
            <CatalogSelect
              kind="violationType"
              violationSide="company"
              value={violationTypeId}
              onChange={setViolationTypeId}
              ariaLabel={t('fleet.violations.fields.type')}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.violations.fields.count')}
            required
            missing={required.isMissing('count')}
            {...(required.isMissing('count') && count.trim() !== ''
              ? { error: t('fleet.violations.countMin') }
              : {})}
          >
            <Input
              rule="integer"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field
            label={t('fleet.violations.fields.unitValue')}
            required
            missing={required.isMissing('unitValue')}
            hint={t('fleet.violations.amountHint')}
          >
            <MoneyInput value={unitValue} onChange={(next) => setUnitValue(next)} />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {t('fleet.violations.fields.amount')}
          </span>
          <span data-violation-total className="text-base font-semibold tabular-nums">
            {total === null ? '—' : formatMoney(total, 'EGP', locale)}
          </span>
        </div>
      </fieldset>
    </Dialog>
  );
};

/** Per-event driver row — the amount is recorded as entered; a driver profile must exist. */
export const DriverViolationDialog = ({
  open,
  onClose,
  violation,
  initialVehicleId = '',
  mode = 'edit',
  onConfirmDelete,
  deleting = false,
}: {
  open: boolean;
  onClose: () => void;
  /** null = record; a `driver`-shape row = version-aware edit. */
  violation: FleetViolationDto | null;
  initialVehicleId?: string;
  /** `delete` shows this same form read-only over a delete button — see the vehicle dialog. */
  mode?: 'edit' | 'delete';
  onConfirmDelete?: () => void;
  deleting?: boolean;
}): JSX.Element => {
  const t = useT();
  const readOnly = mode === 'delete';
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState('');
  const [driver, setDriver] = useState('');
  const [violationTypeId, setViolationTypeId] = useState('');
  const [amount, setAmount] = useState('');
  useEffect(() => {
    if (!open) return;
    setVehicleId(violation?.vehicleId ?? initialVehicleId);
    setDate(violation?.date === null || violation === null ? '' : violation.date.slice(0, 10));
    setDriver(
      violation === null
        ? ''
        : isUnknownFleetDriver(violation)
          ? UNKNOWN_DRIVER
          : (violation.driverEmployeeId ?? ''),
    );
    setViolationTypeId(violation?.violationTypeId ?? '');
    setAmount(violation === null ? '' : String(violation.amount));
  }, [open, violation, initialVehicleId]);

  const record = useRecordDriverViolation();
  const update = useUpdateViolation();
  const pending = record.isPending || update.isPending;

  // Save stays pressable — see the vehicle dialog. The car's box is on the record form only (an
  // edit keeps the row's own car); a row from the old book has none, and is refused as it always
  // was, now with the reason named.
  const required = useRequiredFields(
    [
      // The car box is shown only when recording; an edit never sends the car, so a fine from the
      // old book that has none can still be corrected.
      {
        key: 'vehicle',
        label: t('fleet.odometer.columns.vehicle'),
        ok: violation !== null || vehicleId !== '',
      },
      { key: 'date', label: t('fleet.violations.fields.date'), ok: date !== '' },
      { key: 'type', label: t('fleet.violations.fields.type'), ok: violationTypeId !== '' },
      // «مجهول» is an answer: `UNKNOWN_DRIVER` is not empty.
      { key: 'driver', label: t('fleet.violations.fields.driver'), ok: driver !== '' },
      { key: 'amount', label: t('fleet.violations.fields.amount'), ok: isMoney(amount) },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    if (violation === null) {
      await record.mutateAsync({
        vehicleId,
        date: new Date(date),
        driverEmployeeId: pickedDriverId(driver),
        violationTypeId,
        amount: Number(amount),
      });
    } else {
      await update.mutateAsync({
        id: violation.id,
        body: {
          version: violation.version,
          ...(violationTypeId !== violation.violationTypeId ? { violationTypeId } : {}),
          ...(date !== (violation.date ?? '').slice(0, 10) ? { date: new Date(date) } : {}),
          ...(pickedDriverId(driver) !== violation.driverEmployeeId ||
          (driver === UNKNOWN_DRIVER && !isUnknownFleetDriver(violation))
            ? { driverEmployeeId: pickedDriverId(driver) }
            : {}),
          ...(Number(amount) !== violation.amount ? { amount: Number(amount) } : {}),
        },
      });
    }
    toast.success(t('fleet.violations.saved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={
        readOnly
          ? t('fleet.violations.deleteTitle')
          : violation === null
            ? t('fleet.violations.recordDriver')
            : t('fleet.violations.edit')
      }
      {...(readOnly ? { description: t('fleet.violations.deleteBody') } : {})}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {readOnly ? (
            <Button variant="danger" loading={deleting} onClick={() => onConfirmDelete?.()}>
              {t('fleet.violations.delete')}
            </Button>
          ) : (
            <Button loading={pending} onClick={required.guard(submit)}>
              {t('common.save')}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={readOnly} className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        {violation === null && (
          <Field
            label={t('fleet.odometer.columns.vehicle')}
            required
            missing={required.isMissing('vehicle')}
          >
            <VehicleCodeCombobox
              value={vehicleId}
              onChange={setVehicleId}
              anyStatus
              ariaLabel={t('fleet.odometer.columns.vehicle')}
              placeholder={t('fleet.accidents.vehiclePlaceholder')}
            />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.violations.fields.date')}
            required
            missing={required.isMissing('date')}
          >
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field
            label={t('fleet.violations.fields.type')}
            required
            missing={required.isMissing('type')}
          >
            <CatalogSelect
              kind="violationType"
              violationSide="driver"
              value={violationTypeId}
              onChange={setViolationTypeId}
              ariaLabel={t('fleet.violations.fields.type')}
            />
          </Field>
        </div>
        <Field
          label={t('fleet.violations.fields.driver')}
          required
          missing={required.isMissing('driver')}
        >
          {/* THE DRIVERS REGISTRY, and it lists BEFORE anything is typed.
              This was `OptionalEmployeeField`, which searched the whole payroll and showed
              nothing at all until a letter was typed — so clearing a driver and coming back to
              the box left a reader staring at an empty field with no way to discover who could
              go in it, and offering colleagues who are not drivers if they guessed a name. This
              is the same control every other «مين السائق؟» on the screen uses: driving seats
              only, and one page of them already on show when it opens. */}
          <RegistryDriverPicker
            withUnknown
            value={driver === '' ? [] : [driver]}
            onChange={(next) => setDriver(next[0] ?? '')}
            fullWidth
            className="w-full"
          />
        </Field>
        <Field
          label={t('fleet.violations.fields.amount')}
          required
          missing={required.isMissing('amount')}
        >
          <MoneyInput value={amount} onChange={(next) => setAmount(next)} />
        </Field>
      </fieldset>
    </Dialog>
  );
};

/** The ONE per-(vehicle, year) grievance figure — a PUT set/replace (H9's fate). */
export const GrievanceDialog = ({
  open,
  onClose,
  vehicleId,
  code,
  year,
  current,
}: {
  open: boolean;
  onClose: () => void;
  vehicleId: string;
  /** The vehicle's code, for the title — the rollup row already carries it. */
  code: string;
  year: number;
  /** The currently stored figure, prefilled so a re-set edits in place. */
  current: number;
}): JSX.Element => {
  const t = useT();
  const [total, setTotal] = useState('');
  useEffect(() => {
    if (open) setTotal(current === 0 ? '' : String(current));
  }, [open, current]);

  const set = useSetGrievance();
  // Save stays pressable: an empty figure is named and its box turns red (`useRequiredFields`).
  const required = useRequiredFields(
    [
      {
        key: 'total',
        label: t('fleet.violations.fields.totalBeforeGrievance'),
        ok: isMoney(total),
      },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    await set.mutateAsync({ vehicleId, year, totalBeforeGrievance: Number(total) });
    toast.success(t('fleet.violations.grievanceSaved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={t('fleet.violations.grievanceTitle', { code, year: String(year) })}
      description={t('fleet.violations.grievanceHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={set.isPending} onClick={required.guard(submit)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <Field
          label={t('fleet.violations.fields.totalBeforeGrievance')}
          required
          missing={required.isMissing('total')}
        >
          <MoneyInput value={total} onChange={setTotal} />
        </Field>
      </div>
    </Dialog>
  );
};
