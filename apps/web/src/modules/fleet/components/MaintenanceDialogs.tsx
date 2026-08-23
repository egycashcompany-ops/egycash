// Maintenance visit dialogs (§4.2): check-in (FR-4 — one open visit; the vehicle select
// pre-trims cars already in the workshop, the server remains the authority), check-out (records
// the custody and the exit date), and the facts edit. All version-aware; the counter hint is
// the server's expected reading, never a client computation.
import { useEffect, useMemo, useState } from 'react';
import { type FleetMaintenanceVisitDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Combobox } from '../../../shared/ui/Combobox';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../shared/lib/format';
import {
  useFleetCatalog,
  useCheckInMaintenance,
  useCheckOutMaintenance,
  useExpectedReading,
  useUpdateMaintenance,
  useVehicles,
} from '../api/fleet-queries';
import { useCan } from '../../../platform/rbac/Can';
import { vehicleCodeLabel } from '../lib/vehicle-code-options';
import { CatalogSelect } from './CatalogSelect';
import { OptionalEmployeeField } from './OptionalEmployeeField';

const today = (): string => new Date().toISOString().slice(0, 10);
/** How many matches a code search offers at once — a shortlist to pick from, not a catalogue. */
const VEHICLE_SEARCH_SIZE = 20;

/**
 * The parts fitted, chosen from the `sparePart` catalog — the same admin-owned vocabulary the
 * Fleet Catalogs screen edits, read through the same hook. Free text is what this replaces: two
 * spellings of one part are two parts to every report that counts them.
 */
const SparePartsField = ({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useFleetCatalog('sparePart');
  const options = useMemo(
    () =>
      (data?.items ?? []).map((item) => ({
        value: item.id,
        label: item.name[locale],
      })),
    [data, locale],
  );
  return (
    <MultiSelect
      showSelectedValues
      // The `<Field>` above already names this; the trigger says what to DO with it instead of
      // repeating the label. `label` remains the accessible name.
      label={t('fleet.maintenance.fields.spareParts')}
      placeholder={t('common.select')}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
};

export const CheckInDialog = ({
  open,
  onClose,
  initialVehicleCode = '',
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Pre-selected vehicle, by CODE (arriving from a page filtered to one car).
   *
   * A code rather than an id, because the caller no longer holds the registry to look an id up
   * in — and because the code is what it actually knows. The dialog asks the registry for it and
   * takes the id from the answer.
   */
  initialVehicleCode?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [vehicleId, setVehicleId] = useState('');
  // What the registry is being asked for, and the code already chosen. The chosen one is held
  // separately because the search moves on: the next query will not contain it, and the box must
  // go on showing what is selected rather than blanking as the operator types. Both are seeded
  // from the prop rather than only by the reset effect — an effect runs after the first paint, so
  // a carried-over car would flash as an empty box.
  const [codeQuery, setCodeQuery] = useState(initialVehicleCode);
  const [pickedCode, setPickedCode] = useState(initialVehicleCode);
  const [inDate, setInDate] = useState(today());
  const [workshopId, setWorkshopId] = useState('');
  const [workTypeId, setWorkTypeId] = useState('');
  const [odometer, setOdometer] = useState('');
  const [driverIn, setDriverIn] = useState('');
  const [partIds, setPartIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setVehicleId('');
      setPickedCode(initialVehicleCode);
      setCodeQuery(initialVehicleCode);
      setInDate(today());
      setWorkshopId('');
      setWorkTypeId('');
      setOdometer('');
      setDriverIn('');
      setPartIds([]);
      setNotes('');
    }
  }, [open, initialVehicleCode]);

  // The car is picked by CODE and typed into, not scrolled to, and the options are what the
  // SERVER matched for what was typed. A page of the registry filtered in the browser would let
  // only the first `MAX_PAGE_SIZE` cars by code be checked in at all — car 101 could not be
  // chosen, so it could not enter a workshop.
  //
  // Cars already IN a workshop are dropped from the shortlist, as the old select did: the server
  // refuses them under FR-4 anyway, and this only spares a guaranteed 409. It trims what the
  // server matched — it never stands in for the search.
  const vehicles = useVehicles(
    {
      status: 'active',
      search: codeQuery.trim() === '' ? undefined : codeQuery.trim(),
      pageSize: VEHICLE_SEARCH_SIZE,
      sortBy: 'code',
      sortDir: 'asc',
    },
    open,
  );
  const byCode = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const v of vehicles.data?.items ?? []) {
      if (v.inWorkshop === true && v.id !== vehicleId) continue;
      map.set(v.code, { id: v.id, label: vehicleCodeLabel(v) });
    }
    return map;
  }, [vehicles.data, vehicleId]);
  const codeOptions = useMemo(() => [...byCode.keys()], [byCode]);
  // What the box shows: the code of the resolved car, or — before the registry has answered for a
  // code carried in from the filter — that code itself.
  const codeOf = (id: string): string =>
    ([...byCode.entries()].find(([, v]) => v.id === id)?.[0] ?? '') || pickedCode;

  // A code carried in from the page's filter names a car this dialog has not got an id for. The
  // opening search IS that code, so the id arrives with its answer and is taken here, once.
  useEffect(() => {
    if (pickedCode === '' || vehicleId !== '') return;
    const found = byCode.get(pickedCode);
    if (found !== undefined) setVehicleId(found.id);
  }, [byCode, pickedCode, vehicleId]);

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
    Number.isInteger(odometerNumber) &&
    // The driver is REQUIRED: a visit records who actually brought the car in, and the server
    // refuses a check-in without one.
    driverIn !== '';

  const submit = async (): Promise<void> => {
    await checkIn.mutateAsync({
      vehicleId,
      inDate: new Date(inDate),
      workshopId,
      workTypeId,
      sparePartIds: partIds,
      odometerAtService: odometerNumber,
      driverInEmployeeId: driverIn,
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
          <Combobox
            value={codeOf(vehicleId)}
            options={codeOptions}
            onChange={(code) => {
              setVehicleId(byCode.get(code)?.id ?? '');
              setPickedCode(byCode.get(code) === undefined ? '' : code);
            }}
            onSearch={setCodeQuery}
            placeholder={t('fleet.odometer.vehiclePlaceholder')}
            emptyText={
              vehicles.isFetching ? t('common.loading') : t('fleet.odometer.vehicleNotFound')
            }
            clearLabel={t('common.clear')}
          />
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
        {/* The DRIVER who brought the car in — the same directory picker the odometer's driver
            slots use. Not the custody employee: that one is the logged-in user, recorded by the
            server, and never asked for here. */}
        <Field label={t('fleet.maintenance.fields.driverIn')} required>
          <OptionalEmployeeField value={driverIn} onChange={setDriverIn} />
        </Field>
        <Field label={t('fleet.maintenance.fields.spareParts')}>
          <SparePartsField value={partIds} onChange={setPartIds} />
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
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [outDate, setOutDate] = useState(today());
  const [exitOdometer, setExitOdometer] = useState('');
  const [driverOut, setDriverOut] = useState('');
  useEffect(() => {
    if (open) {
      setOutDate(today());
      setExitOdometer('');
      setDriverOut('');
    }
  }, [open]);
  const exitNumber = Number(exitOdometer);
  const exitValid = exitOdometer !== '' && Number.isInteger(exitNumber) && exitNumber >= 0;
  // The workshop cannot hand the car back on a lower reading than it arrived on. The server
  // refuses it too; saying so here spares a round-trip.
  const belowEntry = exitValid && visit !== null && exitNumber < visit.odometerAtService;

  const checkOut = useCheckOutMaintenance();

  const submit = async (): Promise<void> => {
    if (visit === null) return;
    await checkOut.mutateAsync({
      id: visit.id,
      body: {
        outDate: new Date(outDate),
        exitOdometer: exitNumber,
        driverOutEmployeeId: driverOut,
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
            disabled={outDate === '' || !exitValid || belowEntry || driverOut === ''}
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {/* Who drove it away. Required, like the exit reading beside it — and, like the
              check-in driver, distinct from the custody employee the server records. */}
          <Field label={t('fleet.maintenance.fields.driverOut')} required>
            <OptionalEmployeeField value={driverOut} onChange={setDriverOut} />
          </Field>
        </div>
        <Field label={t('fleet.maintenance.fields.outDate')} required>
          <Input type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} />
        </Field>
        <Field
          label={t('fleet.maintenance.fields.exitOdometer')}
          required
          hint={
            visit === null
              ? undefined
              : t('fleet.maintenance.exitOdometerHint', {
                  km: formatNumber(visit.odometerAtService, locale),
                })
          }
          error={belowEntry ? t('fleet.maintenance.exitBelowEntry') : undefined}
        >
          <Input
            type="number"
            min={0}
            step={1}
            value={exitOdometer}
            onChange={(e) => setExitOdometer(e.target.value)}
            error={belowEntry}
            dir="ltr"
          />
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
  const [driverIn, setDriverIn] = useState('');
  const [partIds, setPartIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open && visit !== null) {
      setInDate(visit.inDate.slice(0, 10));
      setWorkshopId(visit.workshopId);
      setWorkTypeId(visit.workTypeId);
      setOdometer(String(visit.odometerAtService));
      // A legacy visit has no driver on file; the field opens empty and stays optional there.
      setDriverIn(visit.driverInEmployeeId ?? '');
      setPartIds(visit.sparePartIds);
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
        sparePartIds: partIds,
        odometerAtService: odometerNumber,
        // Only sent when it says something: the endpoint takes a correction, never a clear.
        ...(driverIn === '' ? {} : { driverInEmployeeId: driverIn }),
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
          <Field label={t('fleet.maintenance.fields.driverIn')}>
            <OptionalEmployeeField value={driverIn} onChange={setDriverIn} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            label={t('fleet.maintenance.fields.spareParts')}
            hint={t('fleet.maintenance.sparePartsHint')}
          >
            <SparePartsField value={partIds} onChange={setPartIds} />
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
