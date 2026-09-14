// Maintenance visit dialogs (§4.2): check-in (FR-4 — one open visit; the vehicle select
// pre-trims cars already in the workshop, the server remains the authority), check-out (records
// the custody and the exit date), and the facts edit. All version-aware; the counter hint is
// the server's expected reading, never a client computation.
import { useEffect, useMemo, useState } from 'react';
import {
  vehicleCodeSearchQuery,
  type FleetMaintenanceVisitDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Combobox } from '../../../shared/ui/Combobox';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import {
  useCreateCatalogItem,
  useFleetCatalog,
  useCheckInMaintenance,
  useCheckOutMaintenance,
  useExpectedReading,
  useOdometerBracket,
  useUpdateMaintenance,
  useVehicles,
} from '../api/fleet-queries';
import { useCan } from '../../../platform/rbac/Can';
import { vehicleCodeLabel } from '../lib/vehicle-code-options';
import {
  workshopOdometerBreach,
  workshopOdometerWarningKey,
} from '../lib/workshop-odometer-warning';
import { CatalogSelect } from './CatalogSelect';

/**
 * «نوع العمل ده مش بيصفّر عداد الصيانة» — the warning, or `undefined` when there is nothing to say.
 *
 * A maintenance visit only becomes the alarm's baseline if its work type is flagged
 * `countsForAlarm`; the server's `alarmBaselines` matches on exactly that set. Nothing in either
 * dialog said so, so a visit could be recorded correctly — right car, right date, closed
 * properly — and the alarm would go on reporting «لا صيانة محسوبة بعد» with no hint as to why.
 * Observed on a real stack: four steps followed exactly, and the only wrong thing was a work type
 * nobody had ticked.
 *
 * A WARNING, never a refusal. Plenty of visits legitimately do not reset the counter — a tyre, a
 * body repair — and refusing them would be refusing the truth to prevent a misunderstanding. The
 * silence is what was wrong, not the choice.
 *
 * Undefined while the catalog is still loading: a warning that flashes on every open and then
 * withdraws itself teaches the reader to ignore it.
 */
const useNotCountingWarning = (workTypeId: string): string | undefined => {
  const t = useT();
  const { data } = useFleetCatalog('workType');
  if (workTypeId === '' || data === undefined) return undefined;
  const picked = data.items.find((item) => item.id === workTypeId);
  if (picked === undefined || picked.countsForAlarm === true) return undefined;
  return t('fleet.maintenance.workTypeNotCounting');
};
import { OptionalDriverField } from './OptionalDriverField';

const today = (): string => new Date().toISOString().slice(0, 10);
/** How many matches a code search offers at once — a shortlist to pick from, not a catalogue. */
const VEHICLE_SEARCH_SIZE = 20;

/**
 * The parts fitted, chosen from the `sparePart` catalog — the same admin-owned vocabulary the
 * Fleet Catalogs screen edits, read through the same hook. Free text is what this replaces: two
 * spellings of one part are two parts to every report that counts them.
 *
 * AND A PART THAT IS NOT ON THE LIST CAN BE TYPED — «لو مش موجود عادى يضيفها مش لازم من القايمه».
 * Typing it and pressing Enter creates it in the catalog and selects it in one go, so the reader
 * never has to leave a half-filled visit, walk to /fleet/catalogs, add it, and come back.
 *
 * That is NOT a return to free text, and the difference is the whole point: the typed name becomes
 * a catalog ITEM with an id, so the next visit picks the same one from the list instead of
 * spelling it a second way. The list is still the vocabulary — this only lets it grow from the
 * place the gap is noticed.
 */
const SparePartsField = ({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useFleetCatalog('sparePart');
  const create = useCreateCatalogItem();
  const options = useMemo(
    () =>
      (data?.items ?? []).map((item) => ({
        value: item.id,
        label: item.name[locale],
      })),
    [data, locale],
  );

  // WHO MAY GROW THE LIST is the catalog's own grant, not this screen's. Offering the affordance
  // to a reader the server would refuse is worse than not offering it: they type the part, press
  // Enter, and get a 403 for the one action the form appeared to invite.
  const mayAdd = can('fleetCatalog.manage');

  const add = async (raw: string): Promise<void> => {
    const name = raw.trim();
    if (name === '') return;
    // ALREADY THERE, however it was typed: match case-insensitively against BOTH languages before
    // creating anything. Without this, «فلتر زيت» typed beside an existing «فلتر زيت » is a second
    // part, and the two split every report that counts them — exactly what the catalog exists to
    // prevent. An existing match is simply selected, which is what the typist meant anyway.
    const folded = name.toLocaleLowerCase();
    const existing = (data?.items ?? []).find(
      (item) =>
        item.name.ar.trim().toLocaleLowerCase() === folded ||
        item.name.en.trim().toLocaleLowerCase() === folded,
    );
    if (existing !== undefined) {
      if (!value.includes(existing.id)) onChange([...value, existing.id]);
      return;
    }
    try {
      // ONE NAME, BOTH LANGUAGES. The contract requires each, and a workshop clerk typing a part
      // in Arabic has not been asked for an English one — storing the same string twice is honest
      // about that, and the catalogs screen is where somebody who knows can translate it later.
      // `countsForAlarm: false` is stated rather than left to the schema's default: the flag is
      // only meaningful on a work TYPE, and the contract refuses it as true on any other kind.
      const made = await create.mutateAsync({
        kind: 'sparePart',
        name: { ar: name, en: name },
        countsForAlarm: false,
      });
      onChange([...value, made.id]);
      toast.success(t('fleet.maintenance.sparePartAdded', { name }));
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

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
      // The box is always offered once a part can be TYPED into it — the default threshold hides
      // it on a short list, which is precisely the list most in need of a new entry.
      {...(mayAdd ? { searchThreshold: 0, onCommitSearch: (raw: string) => void add(raw) } : {})}
    />
  );
};

/**
 * The counter warning for one field: which bound was crossed, named with the reading and the day
 * that set it.
 *
 * A bound without its date cannot be acted on — "below 59,800" is a riddle, "below the 59,800
 * recorded on 20 August" tells somebody exactly which record to go and look at. Returns
 * `undefined` (not an empty string) so `Field` renders no warning row at all.
 */
const counterWarning = (
  counter: number | null,
  bracket: {
    lowerBound: number | null;
    lowerBoundAt: string | null;
    upperBound: number | null;
    upperBoundAt: string | null;
  } | null,
  t: (key: string, params?: Record<string, string>) => string,
  locale: 'ar' | 'en',
): string | undefined => {
  const breach = workshopOdometerBreach({ counter, bracket });
  const key = workshopOdometerWarningKey(breach);
  if (key === null || bracket === null) return undefined;
  const km = breach === 'belowChain' ? bracket.lowerBound : bracket.upperBound;
  const at = breach === 'belowChain' ? bracket.lowerBoundAt : bracket.upperBoundAt;
  if (km === null || at === null) return undefined;
  return t(key, { km: formatNumber(km, locale), date: formatDate(at, locale) });
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
  const notCounting = useNotCountingWarning(workTypeId);
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
  //
  // Matched on the CODE alone (`vehicleCodeSearchQuery`) — the same question the box's label asks,
  // and the same one every other vehicle picker in the application now asks.
  const vehicles = useVehicles(
    {
      status: 'active',
      ...vehicleCodeSearchQuery(codeQuery),
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

  // The bracket for THIS visit's own date — so a back-dated check-in is compared with the chain
  // as it stood then, not as it stands now.
  const bracket = useOdometerBracket(vehicleId, inDate, open && vehicleId !== '' && inDate !== '');
  const odometerNumber = Number(odometer);
  // Advice only — see `workshop-odometer-warning`. It is deliberately absent from `complete`
  // below: a suspicious counter is still a counter somebody may have good reason to record.
  const counterWarningText = counterWarning(
    odometer === '' ? null : odometerNumber,
    bracket.data ?? null,
    t,
    locale,
  );
  const complete =
    vehicleId !== '' &&
    inDate !== '' &&
    workshopId !== '' &&
    workTypeId !== '' &&
    odometer !== '' &&
    Number.isInteger(odometerNumber);
  // THE DRIVER IS NOT PART OF `complete` — «سائق الدخول ميكونش اجبارى يكون اختيارى». The car is in
  // the workshop whether or not the person opening the visit can say who drove it there, and the
  // server stores the absence rather than refusing the visit.

  const submit = async (): Promise<void> => {
    await checkIn.mutateAsync({
      vehicleId,
      inDate: new Date(inDate),
      workshopId,
      workTypeId,
      sparePartIds: partIds,
      odometerAtService: odometerNumber,
      // `null`, not `''`: an empty box means nobody was named, and an empty string is not an id.
      driverInEmployeeId: driverIn === '' ? null : driverIn,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    toast.success(t('fleet.maintenance.checkedIn'));
    onClose();
  };

  return (
    <Dialog
      // A FORM, so a stray click does not throw it away — «لو دوست في اى حته الموديل ميتقفلش غير
      // لما ادوس على الاكس». Escape still closes it.
      dismissOnOutsideClick={false}
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
            warning={counterWarningText}
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
          <Field
            label={t('fleet.maintenance.fields.workType')}
            required
            {...(notCounting === undefined ? {} : { warning: notCounting })}
          >
            <CatalogSelect kind="workType" value={workTypeId} onChange={setWorkTypeId} />
          </Field>
        </div>
        {/* The DRIVER who brought the car in — the same directory picker the odometer's driver
            slots use. Not the custody employee: that one is the logged-in user, recorded by the
            server, and never asked for here. */}
        <Field label={t('fleet.maintenance.fields.driverIn')}>
          <OptionalDriverField value={driverIn} onChange={setDriverIn} />
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
  // SEEDED AT FIRST RENDER, not only in the effect below. An effect runs after the paint, so the
  // reader would see the box empty and then filled — and, more usefully here, a value that only
  // an effect supplies is a value that does not exist for anything rendering without one.
  const [exitOdometer, setExitOdometer] = useState(() =>
    visit === null ? '' : String(visit.odometerAtService),
  );
  const [driverOut, setDriverOut] = useState('');
  const [partIds, setPartIds] = useState<string[]>(() => visit?.sparePartIds ?? []);
  useEffect(() => {
    if (open) {
      setOutDate(today());
      // OPENS ON THE READING THE CAR CAME IN ON — «لما بحط [العداد] بيبقى هو هو [عداد] الخروج».
      // A car does not move inside a workshop, so that IS the answer nearly every time, and it was
      // being retyped from the row above. Editable, because a car that was road-tested did move.
      //
      // It matters more here than a saved keystroke: this reading becomes the alarm's baseline, so
      // a digit mistyped while copying it does not stay in this row — it moves the next service.
      setExitOdometer(visit === null ? '' : String(visit.odometerAtService));
      setDriverOut('');
      // The parts the check-in recorded, as the starting point for the list this door writes.
      setPartIds(visit?.sparePartIds ?? []);
    }
  }, [open, visit]);
  const exitNumber = Number(exitOdometer);
  const exitValid = exitOdometer !== '' && Number.isInteger(exitNumber) && exitNumber >= 0;
  // The workshop cannot hand the car back on a lower reading than it arrived on. The server
  // refuses it too; saying so here spares a round-trip. BLOCKING, and it mirrors a server rule.
  const belowEntry = exitValid && visit !== null && exitNumber < visit.odometerAtService;
  // Advice, and a different thing entirely: no server rule refuses this, and the save goes
  // through. It matters most here — the exit reading becomes the alarm's baseline, so a typo
  // does not stay in this row, it moves the next service.
  const bracket = useOdometerBracket(
    visit?.vehicleId ?? '',
    outDate,
    open && visit !== null && outDate !== '',
  );
  const counterWarningText = counterWarning(
    exitOdometer === '' ? null : exitNumber,
    bracket.data ?? null,
    t,
    locale,
  );

  const checkOut = useCheckOutMaintenance();

  const submit = async (): Promise<void> => {
    if (visit === null) return;
    await checkOut.mutateAsync({
      id: visit.id,
      body: {
        outDate: new Date(outDate),
        exitOdometer: exitNumber,
        driverOutEmployeeId: driverOut,
        sparePartIds: partIds,
        version: visit.version,
      },
    });
    toast.success(t('fleet.maintenance.checkedOut'));
    onClose();
  };

  return (
    <Dialog
      // A FORM, so a stray click does not throw it away — «لو دوست في اى حته الموديل ميتقفلش غير
      // لما ادوس على الاكس». Escape still closes it.
      dismissOnOutsideClick={false}
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
            <OptionalDriverField value={driverOut} onChange={setDriverOut} />
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
          warning={belowEntry ? undefined : counterWarningText}
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
        {/* THE PARTS, ON THE DOOR THE CAR LEAVES BY — «قطع الغيار دى بتكون لما باجى اخرجه من
            الورشه برضو». The workshop finds out what a car needs while it has it, so the check-in
            list is a guess and this one is the record. It starts from that guess rather than from
            nothing, so an unchanged list is saved unchanged. */}
        <div className="sm:col-span-2">
          <Field label={t('fleet.maintenance.fields.spareParts')}>
            <SparePartsField value={partIds} onChange={setPartIds} />
          </Field>
        </div>
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
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [inDate, setInDate] = useState('');
  const [workshopId, setWorkshopId] = useState('');
  const [workTypeId, setWorkTypeId] = useState('');
  const notCounting = useNotCountingWarning(workTypeId);
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
  const bracket = useOdometerBracket(
    visit?.vehicleId ?? '',
    inDate,
    open && visit !== null && inDate !== '',
  );
  const odometerNumber = Number(odometer);
  const counterWarningText = counterWarning(
    odometer === '' ? null : odometerNumber,
    bracket.data ?? null,
    t,
    locale,
  );
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
      // A FORM, so a stray click does not throw it away — «لو دوست في اى حته الموديل ميتقفلش غير
      // لما ادوس على الاكس». Escape still closes it.
      dismissOnOutsideClick={false}
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
        <Field
          label={t('fleet.maintenance.fields.odometerAtService')}
          required
          warning={counterWarningText}
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
        <Field
          label={t('fleet.maintenance.fields.workType')}
          required
          {...(notCounting === undefined ? {} : { warning: notCounting })}
        >
          <CatalogSelect kind="workType" value={workTypeId} onChange={setWorkTypeId} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('fleet.maintenance.fields.driverIn')}>
            <OptionalDriverField value={driverIn} onChange={setDriverIn} />
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
