// Maintenance visit dialogs (§4.2): check-in (FR-4 — one open visit; the vehicle select
// pre-trims cars already in the workshop, the server remains the authority), check-out (records
// the custody and the exit date), and the facts edit. All version-aware; the counter hint is
// the server's expected reading, never a client computation.
import { useEffect, useState } from 'react';
import { type FleetMaintenanceVisitDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../shared/lib/format';
import {
  useCheckInMaintenance,
  useCheckOutMaintenance,
  useExpectedReading,
  useUpdateMaintenance,
} from '../api/fleet-queries';
import { useCan } from '../../../platform/rbac/Can';
import { VehicleSelect } from './VehicleSelect';
import { CatalogSelect } from './CatalogSelect';
import { OptionalEmployeeField } from './OptionalEmployeeField';

const today = (): string => new Date().toISOString().slice(0, 10);

/** Comma/newline-separated text ⇄ the spareParts array. */
const splitParts = (text: string): string[] =>
  text
    .split(/[,\n،]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

export const CheckInDialog = ({
  open,
  onClose,
  initialVehicleId = '',
}: {
  open: boolean;
  onClose: () => void;
  initialVehicleId?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [vehicleId, setVehicleId] = useState(initialVehicleId);
  const [inDate, setInDate] = useState(today());
  const [workshopId, setWorkshopId] = useState('');
  const [workTypeId, setWorkTypeId] = useState('');
  const [odometer, setOdometer] = useState('');
  const [parts, setParts] = useState('');
  const [takenInBy, setTakenInBy] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setVehicleId(initialVehicleId);
      setInDate(today());
      setWorkshopId('');
      setWorkTypeId('');
      setOdometer('');
      setParts('');
      setTakenInBy('');
      setNotes('');
    }
  }, [open, initialVehicleId]);

  const expected = useExpectedReading(
    vehicleId,
    open && vehicleId !== '' && can('fleetOdometer.view'),
  );
  const checkIn = useCheckInMaintenance();

  const odometerNumber = Number(odometer);
  const complete =
    vehicleId !== '' &&
    inDate !== '' &&
    workshopId !== '' &&
    workTypeId !== '' &&
    odometer !== '' &&
    Number.isInteger(odometerNumber);

  const submit = async (): Promise<void> => {
    await checkIn.mutateAsync({
      vehicleId,
      inDate: new Date(inDate),
      workshopId,
      workTypeId,
      spareParts: splitParts(parts),
      odometerAtService: odometerNumber,
      takenInByEmployeeId: takenInBy === '' ? null : takenInBy,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    toast.success(t('fleet.maintenance.checkedIn'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.maintenance.checkIn')}
      description={t('fleet.maintenance.checkInHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={checkIn.isPending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.odometer.fields.vehicle')} required>
          <VehicleSelect value={vehicleId} onChange={setVehicleId} excludeInWorkshop />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.maintenance.fields.inDate')} required>
            <Input type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} />
          </Field>
          <Field
            label={t('fleet.maintenance.fields.odometerAtService')}
            required
            hint={
              expected.data?.expectedReading == null
                ? undefined
                : t('fleet.odometer.expectedHint', {
                    km: formatNumber(expected.data.expectedReading, locale),
                  })
            }
          >
            <Input
              type="number"
              min={0}
              step={1}
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('fleet.maintenance.fields.workshop')} required>
            <CatalogSelect kind="workshop" value={workshopId} onChange={setWorkshopId} />
          </Field>
          <Field label={t('fleet.maintenance.fields.workType')} required>
            <CatalogSelect kind="workType" value={workTypeId} onChange={setWorkTypeId} />
          </Field>
        </div>
        <Field
          label={t('fleet.maintenance.fields.spareParts')}
          hint={t('fleet.maintenance.sparePartsHint')}
        >
          <Textarea rows={2} value={parts} onChange={(e) => setParts(e.target.value)} />
        </Field>
        <Field label={t('fleet.maintenance.fields.takenInBy')}>
          <OptionalEmployeeField value={takenInBy} onChange={setTakenInBy} />
        </Field>
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

export const CheckOutDialog = ({
  open,
  onClose,
  visit,
}: {
  open: boolean;
  onClose: () => void;
  visit: FleetMaintenanceVisitDto | null;
}): JSX.Element => {
  const t = useT();
  const [outDate, setOutDate] = useState(today());
  const [takenOutBy, setTakenOutBy] = useState('');
  useEffect(() => {
    if (open) {
      setOutDate(today());
      setTakenOutBy('');
    }
  }, [open]);

  const checkOut = useCheckOutMaintenance();

  const submit = async (): Promise<void> => {
    if (visit === null) return;
    await checkOut.mutateAsync({
      id: visit.id,
      body: {
        outDate: new Date(outDate),
        takenOutByEmployeeId: takenOutBy === '' ? null : takenOutBy,
        version: visit.version,
      },
    });
    toast.success(t('fleet.maintenance.checkedOut'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.maintenance.checkOut')}
      description={t('fleet.maintenance.checkOutHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={checkOut.isPending}
            disabled={outDate === ''}
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.maintenance.fields.outDate')} required>
          <Input type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} />
        </Field>
        <Field label={t('fleet.maintenance.fields.takenOutBy')}>
          <OptionalEmployeeField value={takenOutBy} onChange={setTakenOutBy} />
        </Field>
      </div>
    </Dialog>
  );
};

export const MaintenanceEditDialog = ({
  open,
  onClose,
  visit,
}: {
  open: boolean;
  onClose: () => void;
  visit: FleetMaintenanceVisitDto | null;
}): JSX.Element => {
  const t = useT();
  const [inDate, setInDate] = useState('');
  const [workshopId, setWorkshopId] = useState('');
  const [workTypeId, setWorkTypeId] = useState('');
  const [odometer, setOdometer] = useState('');
  const [parts, setParts] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open && visit !== null) {
      setInDate(visit.inDate.slice(0, 10));
      setWorkshopId(visit.workshopId);
      setWorkTypeId(visit.workTypeId);
      setOdometer(String(visit.odometerAtService));
      setParts(visit.spareParts.join('، '));
      setNotes(visit.notes ?? '');
    }
  }, [open, visit]);

  const update = useUpdateMaintenance();
  const odometerNumber = Number(odometer);
  const complete =
    inDate !== '' &&
    workshopId !== '' &&
    workTypeId !== '' &&
    odometer !== '' &&
    Number.isInteger(odometerNumber);

  const submit = async (): Promise<void> => {
    if (visit === null) return;
    await update.mutateAsync({
      id: visit.id,
      body: {
        inDate: new Date(inDate),
        workshopId,
        workTypeId,
        spareParts: splitParts(parts),
        odometerAtService: odometerNumber,
        notes: notes.trim() === '' ? null : notes.trim(),
        version: visit.version,
      },
    });
    toast.success(t('fleet.maintenance.updated'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.maintenance.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={update.isPending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('fleet.maintenance.fields.inDate')} required>
          <Input type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} />
        </Field>
        <Field label={t('fleet.maintenance.fields.odometerAtService')} required>
          <Input
            type="number"
            min={0}
            step={1}
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('fleet.maintenance.fields.workshop')} required>
          <CatalogSelect kind="workshop" value={workshopId} onChange={setWorkshopId} />
        </Field>
        <Field label={t('fleet.maintenance.fields.workType')} required>
          <CatalogSelect kind="workType" value={workTypeId} onChange={setWorkTypeId} />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label={t('fleet.maintenance.fields.spareParts')}
            hint={t('fleet.maintenance.sparePartsHint')}
          >
            <Textarea rows={2} value={parts} onChange={(e) => setParts(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t('fleet.attendance.fields.notes')}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
};
