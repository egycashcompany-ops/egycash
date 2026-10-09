// Maintenance visit dialogs (§4.2): check-in (FR-4 — one open visit; the vehicle select
// pre-trims cars already in the workshop, the server remains the authority), check-out (records
// the custody and the exit date), and the facts edit. All version-aware; the counter hint is
// the server's expected reading, never a client computation.
//
// «حسن الui … بالفورم بتاعت التسجيل والتعديل»: all three wear the vehicle form's design — its
// panel, header, sections, boxes and footer (`DesignDialog`) — around the same fields, rules and
// required marks as before. Like the vehicle form, none of them closes on a stray click outside
// it: only the ✕, «إلغاء» and Escape do.
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { type FleetMaintenanceVisitDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Input, Textarea } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import {
  useCreateCatalogItem,
  useFleetCatalog,
  useCheckInMaintenance,
  useCheckOutMaintenance,
  useExpectedReading,
  useOdometerBracket,
  useAllVehicles,
  useUpdateMaintenance,
} from '../api/fleet-queries';
import { useCan } from '../../../platform/rbac/Can';
import {
  workshopOdometerBreach,
  workshopOdometerWarningKey,
} from '../lib/workshop-odometer-warning';
import { resolveCarriedVehicleCode } from '../lib/vehicle-code-options';
import { CatalogSelect } from './CatalogSelect';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { DATE_ICON, DesignField, LOOK, MONO, boxTone, carBoxClass } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';

/** The vehicle form's boxes — text, figures, dates — from the design's `add` look. */
const box = boxTone(LOOK.add);
const numberBox = cn(box, MONO);
// A date's text starts at the box's left, where a refused box draws its «!».
const dateBox = cn(box, MONO, DATE_ICON.add, 'cursor-pointer !pl-10');

/** The rose frame and glow of a required box Save found empty, laid over a control from outside. */
const MISSING_GLOW =
  'shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)] dark:!bg-[#0a1233]';

/**
 * A `<select>` takes no tone of its own — the same box, forced over the control's base, as the
 * vehicle form draws its catalogs; red with the design's glow while a required one is empty.
 */
const selectBox = (missing = false): string =>
  cn(
    '!h-auto !rounded-xl !py-3 !ps-4 !text-[15px] !font-medium !text-slate-900 dark:!text-white focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500',
    missing
      ? cn('!border-rose-500/70 !bg-slate-50', MISSING_GLOW)
      : '!border-slate-200 !bg-slate-50 dark:!border-[#2b3b6b] dark:!bg-[#0a1233]',
  );

/**
 * The same box for a LIST — the spare parts and the driver pickers, whose trigger is a button —
 * and for the chosen driver's row with its ✕. The open list sits on the design's panel colour, and
 * what is picked in it is the site's purple.
 */
const listBox = (missing = false): string =>
  cn(
    '[&_button[aria-haspopup]]:!w-full [&_button[aria-haspopup]]:!justify-between [&_button[aria-haspopup]]:!rounded-xl [&_button[aria-haspopup]]:!py-3 [&_button[aria-haspopup]]:!ps-4 [&_button[aria-haspopup]]:!text-[15px] [&_button[aria-haspopup]]:!font-medium [&_button[aria-haspopup]]:shadow-inner',
    '[&_button[aria-haspopup]]:!text-slate-900 dark:[&_button[aria-haspopup]]:!text-white [&_button[aria-haspopup]:focus]:!border-indigo-500',
    missing
      ? '[&_button[aria-haspopup]]:!border-rose-500/70 [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#0a1233] [&_button[aria-haspopup]]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)]'
      : '[&_button[aria-haspopup]]:!border-slate-200 dark:[&_button[aria-haspopup]]:!border-[#2b3b6b] [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#0a1233]',
    '[&_[role=listbox]]:!rounded-xl [&_[role=listbox]]:!border-slate-200 dark:[&_[role=listbox]]:!border-[#2b3b6b] [&_[role=listbox]]:!bg-white dark:[&_[role=listbox]]:!bg-[#131d35] [&_[role=listbox]]:!shadow-2xl',
    '[&_[role=option]:hover]:!bg-brand-500/15 [&_[role=option][aria-selected=true]]:!font-bold [&_[role=option][aria-selected=true]]:!text-brand-700 dark:[&_[role=option][aria-selected=true]]:!text-brand-200',
    // A driver already named: the row that shows them, in the same box.
    '[&>.justify-between]:!rounded-xl [&>.justify-between]:!border-slate-200 dark:[&>.justify-between]:!border-[#2b3b6b] [&>.justify-between]:!bg-slate-50 dark:[&>.justify-between]:!bg-[#0a1233] [&>.justify-between]:!py-3 [&>.justify-between]:!ps-4 [&>.justify-between]:shadow-inner [&>.justify-between_.text-sm]:!text-[15px] [&>.justify-between_.text-sm]:!font-medium',
  );

/**
 * The design's car box (`carBoxClass`). It draws its own frame, so a required car Save found empty
 * is turned red here, over that frame, as every other box of the form is.
 */
const carBox = (missing: boolean): string =>
  cn(
    carBoxClass(false),
    missing &&
      '[&&_input]:!border-rose-500/70 dark:[&&_input]:!border-rose-500/70 [&&_input]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)]',
  );

/** The notes box — `Textarea` takes no tone, so the design's colours are forced over its own. */
const notesBox =
  '!rounded-xl !border-slate-200 !bg-slate-50 !px-4 !py-3 !text-[15px] !font-medium !text-slate-900 shadow-inner focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500 dark:!border-[#2b3b6b] dark:!bg-[#0a1233] dark:!text-white';

/** Two boxes to a row on a computer, one on a phone — the vehicle form's grid. */
const GRID = 'grid grid-cols-1 items-start gap-5 md:grid-cols-2';

/**
 * «فورم ادخال الورشه كبرها بالطول» — the check-in and the edit open TALL, so the parts list opens
 * inside them with room to show rather than against the panel's bottom edge.
 */
const TALL = 'min-h-[55vh] space-y-7';

/**
 * A design field that can also ADVISE — `Field`'s amber `warning`, which `DesignField` does not
 * draw: the value is probably not what was meant, and the save goes through anyway. Advice gives
 * way to anything the field itself has to say — a refused keystroke, an error, «حقل مطلوب» —
 * exactly as it did under `Field`, and it takes the place of the grey hint.
 */
const AdvisedField = ({
  warning,
  hint,
  children,
  ...field
}: ComponentProps<typeof DesignField> & { warning?: string | undefined }): JSX.Element => (
  <div className="space-y-2 [&:has([role=alert])>[data-field-warning]]:hidden">
    <DesignField {...field} {...(warning === undefined && hint !== undefined ? { hint } : {})}>
      {children}
    </DesignField>
    {warning !== undefined && (
      <p
        data-field-warning="true"
        className="text-[13px] font-semibold text-amber-600 dark:text-amber-400"
      >
        {warning}
      </p>
    )}
  </div>
);

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
import { VehicleCodeCombobox } from './VehicleCodeCombobox';

const today = (): string => new Date().toISOString().slice(0, 10);

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
      clearable
      showSelectedValues
      // The design's box is the whole width of its row, so the trigger is too.
      fullWidth
      className="w-full"
      // The `<Field>` above already names this; the trigger says what to DO with it instead of
      // repeating the label. `label` remains the accessible name.
      label={t('fleet.maintenance.fields.spareParts')}
      placeholder={t('common.select')}
      // «اول ما اختار يمسح اللى فى السيرش» — the next part is typed into an empty box.
      clearSearchOnPick
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
  // A code carried in from the page's filter, until the registry has turned it into an id. Seeded
  // from the prop, not only from the reset effect, so the first paint already knows it.
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
      setInDate(today());
      setWorkshopId('');
      setWorkTypeId('');
      setOdometer('');
      setDriverIn('');
      setPartIds([]);
      setNotes('');
    }
  }, [open, initialVehicleCode]);

  // The car is picked by CODE and typed into, from the WHOLE registry of active cars
  // (`VehicleCodeCombobox`) — every one of them, where it used to be a twenty-car server shortlist.
  // Cars already IN a workshop are left out, as before: the server refuses them under FR-4, and
  // this only spares a guaranteed 409.
  //
  // A code carried in from the page's filter names a car this dialog has not got an id for. The
  // registry the picker loads is read for it here, once — the same cached list.
  const registry = useAllVehicles({}, open && pickedCode !== '');
  useEffect(() => {
    if (pickedCode === '' || vehicleId !== '') return;
    if (registry.data === undefined) return;
    const found = resolveCarriedVehicleCode(registry.data.items, pickedCode, {
      excludeInWorkshop: true,
    });
    // No active car carries it, or it is already in a workshop: let it go, so the box reads empty
    // rather than holding a code the check-in cannot take.
    if (found === null) setPickedCode('');
    else setVehicleId(found);
  }, [registry.data, pickedCode, vehicleId]);

  const expected = useExpectedReading(
    vehicleId,
    open && vehicleId !== '' && can('fleetOdometer.view'),
  );
  const checkIn = useCheckInMaintenance();

  // The bracket for THIS visit's own date — so a back-dated check-in is compared with the chain
  // as it stood then, not as it stands now.
  const bracket = useOdometerBracket(vehicleId, inDate, open && vehicleId !== '' && inDate !== '');
  const odometerNumber = Number(odometer);
  const lastReading = bracket.data?.lowerBound ?? null;
  const belowLast =
    odometer !== '' &&
    (!Number.isInteger(odometerNumber) || (lastReading !== null && odometerNumber < lastReading));
  // Advice only — see `workshop-odometer-warning`. It is deliberately absent from `required`
  // below: a suspicious counter is still a counter somebody may have good reason to record.
  const counterWarningText = counterWarning(
    odometer === '' ? null : odometerNumber,
    bracket.data ?? null,
    t,
    locale,
  );
  // Save stays pressable: pressing it with any of these empty names them and turns their boxes red
  // (`useRequiredFields`).
  const required = useRequiredFields(
    [
      { key: 'vehicle', label: t('fleet.odometer.fields.vehicle'), ok: vehicleId !== '' },
      { key: 'inDate', label: t('fleet.maintenance.fields.inDate'), ok: inDate !== '' },
      // «مش اجبارى … انه يكتب عداد بس لو كتب ميدخلش اقل من القيمة اللى قبلها»: empty is fine; a
      // counter typed below the last reading before the visit is refused.
      { key: 'odometer', label: t('fleet.maintenance.fields.odometerAtService'), ok: !belowLast },
      { key: 'workshop', label: t('fleet.maintenance.fields.workshop'), ok: workshopId !== '' },
      { key: 'workType', label: t('fleet.maintenance.fields.workType'), ok: workTypeId !== '' },
    ],
    open,
  );
  // THE DRIVER IS NOT PART OF `required` — «سائق الدخول ميكونش اجبارى يكون اختيارى». The car is in
  // the workshop whether or not the person opening the visit can say who drove it there, and the
  // server stores the absence rather than refusing the visit.

  const submit = async (): Promise<void> => {
    await checkIn.mutateAsync({
      vehicleId,
      inDate: new Date(inDate),
      workshopId,
      workTypeId,
      sparePartIds: partIds,
      // Optional: an empty box is a visit with no counter, never a counter of 0.
      odometerAtService: odometer === '' ? null : odometerNumber,
      // `null`, not `''`: an empty box means nobody was named, and an empty string is not an id.
      driverInEmployeeId: driverIn === '' ? null : driverIn,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    toast.success(t('fleet.maintenance.checkedIn'));
    onClose();
  };

  return (
    <DesignDialog
      // A FORM, so a stray click does not throw it away — «لو دوست في اى حته الموديل ميتقفلش غير
      // لما ادوس على الاكس». The design's backdrop takes no click; the ✕, «إلغاء» and Escape close.
      open={open}
      onClose={onClose}
      title={t('fleet.maintenance.checkIn')}
      subtitle={t('fleet.maintenance.checkInHint')}
      icon={PATH.truck}
      panelProps={{ 'data-maintenance-form': 'checkIn' }}
      footer={
        <>
          <DesignSave
            data-maintenance-save="checkIn"
            busy={checkIn.isPending}
            onClick={required.guard(submit)}
          />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      {/* «فورم ادخال الورشه كبرها بالطول» — the parts list opens inside it with room to show. */}
      <div className={TALL}>
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <DesignSection title={t('fleet.maintenance.form.sections.visit')} icon={PATH.truck}>
          <DesignField
            label={t('fleet.odometer.fields.vehicle')}
            required
            missing={required.isMissing('vehicle')}
          >
            <div className={carBox(required.isMissing('vehicle'))}>
              <VehicleCodeCombobox
                value={vehicleId}
                onChange={(id) => {
                  setVehicleId(id);
                  setPickedCode('');
                }}
                excludeInWorkshop
                // A carried-in code is named from the first paint, while it is being resolved.
                pendingCode={pickedCode}
                placeholder={t('fleet.odometer.vehiclePlaceholder')}
                emptyText={t('fleet.odometer.vehicleNotFound')}
              />
            </div>
          </DesignField>
          <div className={GRID}>
            <DesignField
              label={t('fleet.maintenance.fields.inDate')}
              required
              missing={required.isMissing('inDate')}
            >
              <Input
                type="date"
                value={inDate}
                onChange={(e) => setInDate(e.target.value)}
                tone={dateBox}
              />
            </DesignField>
            <AdvisedField
              label={t('fleet.maintenance.fields.odometerAtService')}
              missing={required.isMissing('odometer')}
              hint={
                expected.data?.expectedReading == null
                  ? t('fleet.maintenance.odometerOptional')
                  : t('fleet.odometer.expectedHint', {
                      km: formatNumber(expected.data.expectedReading, locale),
                    })
              }
              {...(belowLast && lastReading !== null
                ? {
                    error: t('fleet.maintenance.odometerBelowLast', {
                      km: formatNumber(lastReading, locale),
                      date: formatDate(bracket.data?.lowerBoundAt ?? null, locale),
                    }),
                  }
                : {})}
              warning={belowLast ? undefined : counterWarningText}
            >
              <Input
                rule="integer"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                dir="ltr"
                tone={numberBox}
              />
            </AdvisedField>
            <DesignField
              label={t('fleet.maintenance.fields.workshop')}
              required
              missing={required.isMissing('workshop')}
            >
              <CatalogSelect
                kind="workshop"
                value={workshopId}
                onChange={setWorkshopId}
                ariaLabel={t('fleet.maintenance.fields.workshop')}
                className={selectBox(required.isMissing('workshop'))}
              />
            </DesignField>
            <AdvisedField
              label={t('fleet.maintenance.fields.workType')}
              required
              missing={required.isMissing('workType')}
              {...(notCounting === undefined ? {} : { warning: notCounting })}
            >
              <CatalogSelect
                kind="workType"
                value={workTypeId}
                onChange={setWorkTypeId}
                ariaLabel={t('fleet.maintenance.fields.workType')}
                className={selectBox(required.isMissing('workType'))}
              />
            </AdvisedField>
          </div>
        </DesignSection>
        <DesignSection title={t('fleet.maintenance.form.sections.details')} icon={PATH.box}>
          {/* The DRIVER who brought the car in — the same directory picker the odometer's driver
              slots use. Not the custody employee: that one is the logged-in user, recorded by the
              server, and never asked for here. */}
          <DesignField label={t('fleet.maintenance.fields.driverIn')}>
            <div className={listBox()}>
              <OptionalDriverField value={driverIn} onChange={setDriverIn} />
            </div>
          </DesignField>
          <DesignField label={t('fleet.maintenance.fields.spareParts')}>
            <div className={listBox()}>
              <SparePartsField value={partIds} onChange={setPartIds} />
            </div>
          </DesignField>
          <DesignField label={t('fleet.attendance.fields.notes')}>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={notesBox}
            />
          </DesignField>
        </DesignSection>
      </div>
    </DesignDialog>
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
      setExitOdometer(
        visit === null || visit.odometerAtService === null ? '' : String(visit.odometerAtService),
      );
      setDriverOut('');
      // The parts the check-in recorded, as the starting point for the list this door writes.
      setPartIds(visit?.sparePartIds ?? []);
    }
  }, [open, visit]);
  const exitNumber = Number(exitOdometer);
  const exitValid = exitOdometer !== '' && Number.isInteger(exitNumber) && exitNumber >= 0;
  // The workshop cannot hand the car back on a lower reading than it arrived on. The server
  // refuses it too; saying so here spares a round-trip. BLOCKING, and it mirrors a server rule.
  const belowEntry =
    exitValid &&
    visit !== null &&
    visit.odometerAtService !== null &&
    exitNumber < visit.odometerAtService;
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
  // «مش اجبارى … بس لو كتب ميدخلش اقل من القيمة اللى قبلها»: the exit counter may be left empty;
  // written, it may not be below the last reading before the check-out.
  const exitLast = bracket.data?.lowerBound ?? null;
  const exitBelowLast = exitValid && exitLast !== null && exitNumber < exitLast;
  // Save stays pressable (`useRequiredFields`). A reading below the entry one is named with the
  // empty values, and its Field still says why — `exitBelowEntry` outranks «حقل مطلوب».
  const required = useRequiredFields(
    [
      { key: 'driverOut', label: t('fleet.maintenance.fields.driverOut'), ok: driverOut !== '' },
      { key: 'outDate', label: t('fleet.maintenance.fields.outDate'), ok: outDate !== '' },
      {
        key: 'exitOdometer',
        label: t('fleet.maintenance.fields.exitOdometer'),
        ok: exitOdometer === '' || (exitValid && !belowEntry && !exitBelowLast),
      },
    ],
    open,
  );

  const checkOut = useCheckOutMaintenance();

  const submit = async (): Promise<void> => {
    if (visit === null) return;
    await checkOut.mutateAsync({
      id: visit.id,
      body: {
        outDate: new Date(outDate),
        exitOdometer: exitOdometer === '' ? null : exitNumber,
        driverOutEmployeeId: driverOut,
        sparePartIds: partIds,
        version: visit.version,
      },
    });
    toast.success(t('fleet.maintenance.checkedOut'));
    onClose();
  };

  return (
    <DesignDialog
      // A FORM, so a stray click does not throw it away — «لو دوست في اى حته الموديل ميتقفلش غير
      // لما ادوس على الاكس». The design's backdrop takes no click; the ✕, «إلغاء» and Escape close.
      open={open}
      onClose={onClose}
      title={t('fleet.maintenance.checkOut')}
      subtitle={t('fleet.maintenance.checkOutHint')}
      icon={PATH.truck}
      panelProps={{ 'data-maintenance-form': 'checkOut' }}
      footer={
        <>
          <DesignSave
            data-maintenance-save="checkOut"
            busy={checkOut.isPending}
            onClick={required.guard(submit)}
          />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
      <DesignSection title={t('fleet.maintenance.form.sections.exit')} icon={PATH.truck}>
        {/* Who drove it away. Required, like the exit reading beside it — and, like the
            check-in driver, distinct from the custody employee the server records. */}
        <DesignField
          label={t('fleet.maintenance.fields.driverOut')}
          required
          missing={required.isMissing('driverOut')}
        >
          <div className={listBox(required.isMissing('driverOut'))}>
            <OptionalDriverField value={driverOut} onChange={setDriverOut} />
          </div>
        </DesignField>
        <div className={GRID}>
          <DesignField
            label={t('fleet.maintenance.fields.outDate')}
            required
            missing={required.isMissing('outDate')}
          >
            <Input
              type="date"
              value={outDate}
              onChange={(e) => setOutDate(e.target.value)}
              tone={dateBox}
            />
          </DesignField>
          <AdvisedField
            label={t('fleet.maintenance.fields.exitOdometer')}
            missing={required.isMissing('exitOdometer')}
            hint={
              visit === null || visit.odometerAtService === null
                ? t('fleet.maintenance.odometerOptional')
                : t('fleet.maintenance.exitOdometerHint', {
                    km: formatNumber(visit.odometerAtService, locale),
                  })
            }
            error={
              belowEntry
                ? t('fleet.maintenance.exitBelowEntry')
                : exitBelowLast && exitLast !== null
                  ? t('fleet.maintenance.odometerBelowLast', {
                      km: formatNumber(exitLast, locale),
                      date: formatDate(bracket.data?.lowerBoundAt ?? null, locale),
                    })
                  : undefined
            }
            warning={belowEntry || exitBelowLast ? undefined : counterWarningText}
          >
            <Input
              rule="integer"
              value={exitOdometer}
              onChange={(e) => setExitOdometer(e.target.value)}
              error={belowEntry || exitBelowLast}
              dir="ltr"
              tone={numberBox}
            />
          </AdvisedField>
        </div>
        {/* THE PARTS, ON THE DOOR THE CAR LEAVES BY — «قطع الغيار دى بتكون لما باجى اخرجه من
            الورشه برضو». The workshop finds out what a car needs while it has it, so the check-in
            list is a guess and this one is the record. It starts from that guess rather than from
            nothing, so an unchanged list is saved unchanged. */}
        <DesignField label={t('fleet.maintenance.fields.spareParts')}>
          <div className={listBox()}>
            <SparePartsField value={partIds} onChange={setPartIds} />
          </div>
        </DesignField>
      </DesignSection>
    </DesignDialog>
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
      setOdometer(visit.odometerAtService === null ? '' : String(visit.odometerAtService));
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
  // Optional, and refused below the last reading — only when this edit CHANGES it, so a visit
  // the old book left below the chain can still have its other facts corrected.
  const editLast = bracket.data?.lowerBound ?? null;
  const counterChanged =
    visit !== null &&
    odometer !== (visit.odometerAtService === null ? '' : String(visit.odometerAtService));
  const editBelowLast =
    odometer !== '' &&
    (!Number.isInteger(odometerNumber) ||
      (counterChanged && editLast !== null && odometerNumber < editLast));
  const required = useRequiredFields(
    [
      { key: 'inDate', label: t('fleet.maintenance.fields.inDate'), ok: inDate !== '' },
      {
        key: 'odometer',
        label: t('fleet.maintenance.fields.odometerAtService'),
        ok: !editBelowLast,
      },
      { key: 'workshop', label: t('fleet.maintenance.fields.workshop'), ok: workshopId !== '' },
      { key: 'workType', label: t('fleet.maintenance.fields.workType'), ok: workTypeId !== '' },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    if (visit === null) return;
    await update.mutateAsync({
      id: visit.id,
      body: {
        inDate: new Date(inDate),
        workshopId,
        workTypeId,
        sparePartIds: partIds,
        odometerAtService: odometer === '' ? null : odometerNumber,
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
    <DesignDialog
      // A FORM, so a stray click does not throw it away — «لو دوست في اى حته الموديل ميتقفلش غير
      // لما ادوس على الاكس». The design's backdrop takes no click; the ✕, «إلغاء» and Escape close.
      open={open}
      onClose={onClose}
      title={t('fleet.maintenance.edit')}
      // The car the visit is for, as the vehicle form names the car it edits.
      {...(visit?.vehicleCode == null
        ? {}
        : {
            subtitle: (
              <span dir="ltr" className={MONO}>
                {visit.vehicleCode}
              </span>
            ),
          })}
      icon={PATH.edit}
      panelProps={{ 'data-maintenance-form': 'edit' }}
      footer={
        <>
          <DesignSave
            data-maintenance-save="edit"
            busy={update.isPending}
            onClick={required.guard(submit)}
          />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      {/* «فورم ادخال الورشه كبرها بالطول» — the parts list opens inside it with room to show. */}
      <div className={TALL}>
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <DesignSection title={t('fleet.maintenance.form.sections.visit')} icon={PATH.calendar}>
          <div className={GRID}>
            <DesignField
              label={t('fleet.maintenance.fields.inDate')}
              required
              missing={required.isMissing('inDate')}
            >
              <Input
                type="date"
                value={inDate}
                onChange={(e) => setInDate(e.target.value)}
                tone={dateBox}
              />
            </DesignField>
            <AdvisedField
              label={t('fleet.maintenance.fields.odometerAtService')}
              missing={required.isMissing('odometer')}
              hint={t('fleet.maintenance.odometerOptional')}
              {...(editBelowLast && editLast !== null
                ? {
                    error: t('fleet.maintenance.odometerBelowLast', {
                      km: formatNumber(editLast, locale),
                      date: formatDate(bracket.data?.lowerBoundAt ?? null, locale),
                    }),
                  }
                : {})}
              warning={editBelowLast ? undefined : counterWarningText}
            >
              <Input
                rule="integer"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                dir="ltr"
                tone={numberBox}
              />
            </AdvisedField>
            <DesignField
              label={t('fleet.maintenance.fields.workshop')}
              required
              missing={required.isMissing('workshop')}
            >
              <CatalogSelect
                kind="workshop"
                value={workshopId}
                onChange={setWorkshopId}
                ariaLabel={t('fleet.maintenance.fields.workshop')}
                className={selectBox(required.isMissing('workshop'))}
              />
            </DesignField>
            <AdvisedField
              label={t('fleet.maintenance.fields.workType')}
              required
              missing={required.isMissing('workType')}
              {...(notCounting === undefined ? {} : { warning: notCounting })}
            >
              <CatalogSelect
                kind="workType"
                value={workTypeId}
                onChange={setWorkTypeId}
                ariaLabel={t('fleet.maintenance.fields.workType')}
                className={selectBox(required.isMissing('workType'))}
              />
            </AdvisedField>
          </div>
        </DesignSection>
        <DesignSection title={t('fleet.maintenance.form.sections.details')} icon={PATH.box}>
          <DesignField label={t('fleet.maintenance.fields.driverIn')}>
            <div className={listBox()}>
              <OptionalDriverField value={driverIn} onChange={setDriverIn} />
            </div>
          </DesignField>
          <DesignField
            label={t('fleet.maintenance.fields.spareParts')}
            hint={t('fleet.maintenance.sparePartsHint')}
          >
            <div className={listBox()}>
              <SparePartsField value={partIds} onChange={setPartIds} />
            </div>
          </DesignField>
          <DesignField label={t('fleet.attendance.fields.notes')}>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={notesBox}
            />
          </DesignField>
        </DesignSection>
      </div>
    </DesignDialog>
  );
};
