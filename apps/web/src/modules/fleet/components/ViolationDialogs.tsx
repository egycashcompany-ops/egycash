// Violation + grievance dialogs (§4.7, FR-9). Two shapes, two forms, one rule: the FRONTEND
// computes no money. A vehicle statement row sends count × unit value and NEVER an amount —
// the server derives it on create and on every factor edit; a driver row records the amount
// as entered and requires a driver profile to exist (FR-11), which the server enforces. Edits
// keep the row's own shape (cross-shape edits are refused server-side) and send only changed
// fields + version; the vehicle is identity on an existing row, so it is not editable. The
// grievance is the ONE per-(vehicle, year) figure — a PUT set/replace, prefilled from the
// rollup row it was opened on.
import { useEffect, useState } from 'react';
import { type FleetViolationDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useRecordDriverViolation,
  useRecordVehicleViolation,
  useSetGrievance,
  useUpdateViolation,
} from '../api/fleet-queries';
import { VehicleSelect } from './VehicleSelect';
import { CatalogSelect } from './CatalogSelect';
import { OptionalEmployeeField } from './OptionalEmployeeField';

const currentYear = (): number => new Date().getFullYear();

const isMoney = (value: string): boolean =>
  value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

/** Bulk yearly statement row — year + count + unit value; the amount is the server's. */
export const VehicleViolationDialog = ({
  open,
  onClose,
  violation,
  initialVehicleId = '',
}: {
  open: boolean;
  onClose: () => void;
  /** null = record; a `vehicle`-shape row = version-aware edit. */
  violation: FleetViolationDto | null;
  initialVehicleId?: string;
}): JSX.Element => {
  const t = useT();
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

  const complete =
    vehicleId !== '' &&
    violationTypeId !== '' &&
    Number.isInteger(Number(year)) &&
    Number(year) >= 2000 &&
    Number.isInteger(Number(count)) &&
    Number(count) >= 1 &&
    isMoney(unitValue);

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
      title={violation === null ? t('fleet.violations.recordVehicle') : t('fleet.violations.edit')}
      description={t('fleet.violations.vehicleHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {violation === null && (
          <Field label={t('fleet.odometer.columns.vehicle')} required>
            <VehicleSelect value={vehicleId} onChange={setVehicleId} anyStatus />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.violations.fields.year')} required>
            <Input
              type="number"
              min={2000}
              max={2100}
              step={1}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              dir="ltr"
              disabled={violation !== null}
            />
          </Field>
          <Field label={t('fleet.violations.fields.type')} required>
            <CatalogSelect
              kind="violationType"
              value={violationTypeId}
              onChange={setViolationTypeId}
              ariaLabel={t('fleet.violations.fields.type')}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.violations.fields.count')} required>
            <Input
              type="number"
              min={1}
              step={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field
            label={t('fleet.violations.fields.unitValue')}
            required
            hint={t('fleet.violations.amountHint')}
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              value={unitValue}
              onChange={(e) => setUnitValue(e.target.value)}
              dir="ltr"
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
};

/** Per-event driver row — the amount is recorded as entered; a driver profile must exist. */
export const DriverViolationDialog = ({
  open,
  onClose,
  violation,
  initialVehicleId = '',
}: {
  open: boolean;
  onClose: () => void;
  /** null = record; a `driver`-shape row = version-aware edit. */
  violation: FleetViolationDto | null;
  initialVehicleId?: string;
}): JSX.Element => {
  const t = useT();
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState('');
  const [driver, setDriver] = useState('');
  const [violationTypeId, setViolationTypeId] = useState('');
  const [amount, setAmount] = useState('');
  useEffect(() => {
    if (!open) return;
    setVehicleId(violation?.vehicleId ?? initialVehicleId);
    setDate(violation?.date === null || violation === null ? '' : violation.date.slice(0, 10));
    setDriver(violation?.driverEmployeeId ?? '');
    setViolationTypeId(violation?.violationTypeId ?? '');
    setAmount(violation === null ? '' : String(violation.amount));
  }, [open, violation, initialVehicleId]);

  const record = useRecordDriverViolation();
  const update = useUpdateViolation();
  const pending = record.isPending || update.isPending;

  const complete =
    vehicleId !== '' && date !== '' && driver !== '' && violationTypeId !== '' && isMoney(amount);

  const submit = async (): Promise<void> => {
    if (violation === null) {
      await record.mutateAsync({
        vehicleId,
        date: new Date(date),
        driverEmployeeId: driver,
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
          ...(driver !== violation.driverEmployeeId ? { driverEmployeeId: driver } : {}),
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
      title={violation === null ? t('fleet.violations.recordDriver') : t('fleet.violations.edit')}
      description={t('fleet.violations.driverHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {violation === null && (
          <Field label={t('fleet.odometer.columns.vehicle')} required>
            <VehicleSelect value={vehicleId} onChange={setVehicleId} anyStatus />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.violations.fields.date')} required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('fleet.violations.fields.type')} required>
            <CatalogSelect
              kind="violationType"
              value={violationTypeId}
              onChange={setViolationTypeId}
              ariaLabel={t('fleet.violations.fields.type')}
            />
          </Field>
        </div>
        <Field label={t('fleet.violations.fields.driver')} required>
          <OptionalEmployeeField value={driver} onChange={setDriver} />
        </Field>
        <Field label={t('fleet.violations.fields.amount')} required>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            dir="ltr"
          />
        </Field>
      </div>
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

  const submit = async (): Promise<void> => {
    await set.mutateAsync({ vehicleId, year, totalBeforeGrievance: Number(total) });
    toast.success(t('fleet.violations.grievanceSaved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.violations.grievanceTitle', { code, year: String(year) })}
      description={t('fleet.violations.grievanceHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={set.isPending} disabled={!isMoney(total)} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('fleet.violations.fields.totalBeforeGrievance')} required>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          dir="ltr"
        />
      </Field>
    </Dialog>
  );
};
