// «تسجيل فاتورة التوكيل» — writing the bill onto a row the workshop opened.
//
// The grey facts (exit date, car, work) came with the row and are not edited here. What the clerk
// writes: the invoice number and amount, whether the car is «ملاكي» (preset from its operation,
// theirs to change), and the insurer — which the car usually already has. When it has none the
// clerk may type one; a name the catalog does not carry is offered for adding to قوائم الحركة and
// for writing onto the car in شاشة السيارات, both through the endpoints those screens use.
import { useEffect, useMemo, useState } from 'react';
import { type FleetDealershipInvoiceDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from './FuelCardBoard';
import { FILTER_ICON } from './FilterWithIcon';
import {
  useCreateCatalogItem,
  useFleetCatalog,
  useUpdateDealershipInvoice,
  useUpdateVehicle,
  useVehicle,
} from '../api/fleet-queries';

/** «حسن الفورم»: a section's name over its boxes. */
const SectionTitle = ({ children }: { children: string }): JSX.Element => (
  <h3 className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
    <span className="h-3.5 w-1 rounded-full bg-brand-500" />
    {children}
  </h3>
);

/** One fact the workshop wrote — read here, never edited: an icon, its name, its value. */
const Fact = ({
  icon,
  label,
  value,
  aside,
  valueClass,
}: {
  icon: readonly string[];
  label: string;
  value: string;
  aside?: JSX.Element;
  valueClass?: string;
}): JSX.Element => (
  <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-[#0c121e]">
    <span className="shrink-0 rounded-lg bg-brand-500/10 p-2 text-brand-600 dark:text-brand-300">
      <BoardIcon d={icon} className="h-4 w-4" />
    </span>
    <span className="min-w-0 flex-1 leading-tight">
      <span className="flex items-center justify-between gap-2">
        <span className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </span>
        {aside}
      </span>
      <span
        className={cn(
          'block truncate text-base font-bold text-slate-900 dark:text-white',
          valueClass,
        )}
      >
        {value}
      </span>
    </span>
  </div>
);

export const DealershipInvoiceDialog = ({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  row: FleetDealershipInvoiceDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [privateCar, setPrivateCar] = useState(false);
  // The insurer as TYPED — a name, matched against the catalog on save.
  const [insurer, setInsurer] = useState('');
  // Typed or picked by the clerk — the car's insurer no longer fills the box after that.
  const [insurerTouched, setInsurerTouched] = useState(false);
  const [addToCatalog, setAddToCatalog] = useState(true);
  const [writeOnVehicle, setWriteOnVehicle] = useState(true);
  const noInsurer = t('fleet.dealership.noInsurer');

  const insurers = useFleetCatalog('insuranceCompany');
  const byName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of insurers.data?.items ?? []) {
      map.set(item.name.ar.trim(), item.id);
      map.set(item.name.en.trim(), item.id);
    }
    return map;
  }, [insurers.data]);
  const names = useMemo(
    () => (insurers.data?.items ?? []).map((item) => localized(item.name, locale)),
    [insurers.data, locale],
  );

  useEffect(() => {
    if (!open || row === null) return;
    setInvoiceNumber(row.invoiceNumber ?? '');
    setInvoiceAmount(row.invoiceAmount === null ? '' : String(row.invoiceAmount));
    setPrivateCar(row.privateCar);
    // «تبقى شركة التامين لا يوجد»: a workshop bill starts with no insurer — the clerk types one,
    // or picks it from the insurers the cars carry.
    setInsurer(row.insuranceCompanyName ?? noInsurer);
    setInsurerTouched(false);
    setAddToCatalog(true);
    setWriteOnVehicle(true);
  }, [open, row]);

  const update = useUpdateDealershipInvoice();
  const createInsurer = useCreateCatalogItem();
  const updateVehicle = useUpdateVehicle();
  const pending = update.isPending || createInsurer.isPending || updateVehicle.isPending;

  const typedRaw = insurer.trim();
  // «لا يوجد» is the absence of an insurer, not a company of that name.
  const typedInsurer = typedRaw === noInsurer ? '' : typedRaw;
  const knownInsurerId = typedInsurer === '' ? null : (byName.get(typedInsurer) ?? null);
  const isNewInsurer = typedInsurer !== '' && knownInsurerId === null;
  const mayAddInsurer = can('fleetCatalog.manage');
  // Writing the insurer onto the car is an edit of the VEHICLE record, which is versioned — so
  // the car is read first, and the offer is only made once its version is in hand.
  const vehicle = useVehicle(open && row?.vehicleId != null ? row.vehicleId : '');
  const mayWriteVehicle =
    can('fleetVehicle.edit') && row?.vehicleId != null && vehicle.data !== undefined;
  // «لو ليها فى شاشه السيارات تامين يجى زى شاشه السيارات بس اقدر اغيرها ل لايوجد»: a bill with
  // no insurer of its own opens on the car's insurer from the registry — still a box the clerk
  // can change, «لا يوجد» included. A car with none keeps «لا يوجد».
  const carInsurerId = vehicle.data?.insuranceCompanyId ?? null;
  const carInsurerName = useMemo(() => {
    const item = (insurers.data?.items ?? []).find((entry) => entry.id === carInsurerId);
    return item === undefined ? null : localized(item.name, locale);
  }, [insurers.data, carInsurerId, locale]);
  useEffect(() => {
    if (!open || row === null || insurerTouched) return;
    if (row.insuranceCompanyName !== null || carInsurerName === null) return;
    setInsurer(carInsurerName);
  }, [open, row, insurerTouched, carInsurerName]);

  const amount = Number(invoiceAmount);
  const amountOk = invoiceAmount !== '' && Number.isFinite(amount) && amount >= 0;
  const numberOk = privateCar || invoiceNumber.trim() !== '';
  // A new insurer the clerk may not add has nowhere to go — the row cannot point at a name.
  const insurerOk = !isNewInsurer || (mayAddInsurer && addToCatalog);
  // Save stays pressable: pressing it short of these names them and turns their boxes red
  // (`useRequiredFields`). Without a row there is nothing to save — `submit` returns on its own.
  const required = useRequiredFields(
    [
      { key: 'invoiceAmount', label: t('fleet.dealership.columns.invoiceAmount'), ok: amountOk },
      { key: 'invoiceNumber', label: t('fleet.dealership.columns.invoiceNumber'), ok: numberOk },
      { key: 'insurer', label: t('fleet.vehicles.fields.insuranceCompany'), ok: insurerOk },
    ],
    open,
  );
  const side = !amountOk
    ? null
    : privateCar && invoiceNumber.trim() === ''
      ? 'custody'
      : 'dealership';

  const submit = async (): Promise<void> => {
    if (row === null) return;
    let insuranceCompanyId: string | null = knownInsurerId;
    if (isNewInsurer && addToCatalog) {
      const created = await createInsurer.mutateAsync({
        kind: 'insuranceCompany',
        name: { ar: typedInsurer, en: typedInsurer },
        countsForAlarm: false,
      });
      insuranceCompanyId = created.id;
    }
    // Write the insurer onto the car too — only when it changed, and only where the clerk may.
    if (
      insuranceCompanyId !== null &&
      insuranceCompanyId !== row.insuranceCompanyId &&
      // The car already carries it — the box was filled from the car.
      insuranceCompanyId !== carInsurerId &&
      mayWriteVehicle &&
      writeOnVehicle &&
      row.vehicleId !== null &&
      vehicle.data !== undefined
    ) {
      await updateVehicle.mutateAsync({
        id: row.vehicleId,
        body: { insuranceCompanyId, version: vehicle.data.version },
      });
    }
    await update.mutateAsync({
      id: row.id,
      body: {
        invoiceNumber: invoiceNumber.trim() === '' ? null : invoiceNumber.trim(),
        invoiceAmount: amount,
        privateCar,
        insuranceCompanyId: typedInsurer === '' ? null : insuranceCompanyId,
        version: row.version,
      },
    });
    toast.success(t('fleet.dealership.saved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      size="lg"
      title={t('fleet.dealership.recordTitle', { code: row?.vehicleCode ?? '—' })}
      description={t('fleet.dealership.recordHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} onClick={required.guard(submit)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {row !== null && (
        <div className="space-y-4">
          <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
          {/* The workshop's facts: what it knew. Read, not written — tiles, not greyed boxes. */}
          <section className="space-y-2">
            <SectionTitle>{t('fleet.dealership.form.workshop')}</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_1fr]">
              <Fact
                icon={PATH.calendar}
                label={t('fleet.dealership.columns.outDate')}
                value={formatDate(row.outDate, locale)}
                valueClass={NUM}
              />
              {/* «علامه ملاكى … فوق كود السياره»: the tick sits on the car code's own label line,
                  so it takes no column of its own. */}
              <Fact
                icon={FILTER_ICON.car}
                label={t('fleet.odometer.columns.vehicle')}
                value={row.vehicleCode ?? '—'}
                valueClass={NUM}
                aside={
                  // «مش عاجبنى شكل العربيه بعلامه صح جمبها»: a switch on the label line, purple
                  // when on, rather than a bare tick box.
                  <button
                    type="button"
                    role="switch"
                    aria-checked={privateCar}
                    data-dealership-private="true"
                    title={t('fleet.dealership.privateCarHint')}
                    onClick={() => setPrivateCar((on) => !on)}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pe-2 ps-1 text-[11px] font-bold transition active:scale-95',
                      privateCar
                        ? 'border-brand-500/60 bg-brand-500/15 text-brand-700 dark:text-brand-200'
                        : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
                    )}
                  >
                    <span
                      className={cn(
                        'relative h-3.5 w-6 rounded-full transition-colors',
                        privateCar ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-700',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all',
                          privateCar ? 'start-3' : 'start-0.5',
                        )}
                      />
                    </span>
                    {t('fleet.dealership.privateCar')}
                  </button>
                }
              />
              <Fact
                icon={FILTER_ICON.motor}
                label={t('fleet.dealership.columns.workType')}
                value={row.workTypeLabel}
              />
            </div>
          </section>
          <section className="space-y-2">
            <SectionTitle>{t('fleet.dealership.form.invoice')}</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label={t('fleet.vehicles.fields.insuranceCompany')}
                missing={required.isMissing('insurer')}
                // Only ever missing as a NEW name that is not being added to the catalog: say what to
                // do about it — tick «add», or (without the grant to add one) pick from the list.
                {...(required.isMissing('insurer')
                  ? {
                      error: mayAddInsurer
                        ? t('fleet.dealership.insurerAddOrClear')
                        : t('fleet.dealership.insurerCannotAdd'),
                    }
                  : {})}
                hint={t('fleet.dealership.insurerPick')}
              >
                <Input
                  list="dealership-insurers"
                  value={insurer}
                  onChange={(e) => {
                    setInsurerTouched(true);
                    setInsurer(e.target.value);
                  }}
                  placeholder={t('fleet.dealership.insurerPlaceholder')}
                  data-dealership-insurer="true"
                />
                <datalist id="dealership-insurers">
                  <option value={noInsurer} />
                  {names.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              <Field
                label={t('fleet.dealership.columns.invoiceAmount')}
                required
                missing={required.isMissing('invoiceAmount')}
              >
                <MoneyInput value={invoiceAmount} onChange={setInvoiceAmount} />
              </Field>
              <Field
                label={t('fleet.dealership.columns.invoiceNumber')}
                required={!privateCar}
                missing={required.isMissing('invoiceNumber')}
                {...(privateCar ? { hint: t('fleet.dealership.invoiceNumberOptional') } : {})}
              >
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder={privateCar ? t('fleet.dealership.invoiceNumberPrivate') : ''}
                  data-dealership-invoice-number="true"
                />
              </Field>
            </div>
          </section>
          {isNewInsurer && (
            <div
              data-dealership-new-insurer="true"
              className="space-y-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
            >
              <p className="font-medium">
                {t('fleet.dealership.insurerNew', { name: typedInsurer })}
              </p>
              {mayAddInsurer ? (
                <Checkbox
                  label={t('fleet.dealership.insurerAddToCatalog')}
                  checked={addToCatalog}
                  onChange={(e) => setAddToCatalog(e.target.checked)}
                />
              ) : (
                <p className="text-red-700 dark:text-red-300">
                  {t('fleet.dealership.insurerCannotAdd')}
                </p>
              )}
              {mayWriteVehicle && (
                <Checkbox
                  label={t('fleet.dealership.insurerWriteOnCar', { code: row.vehicleCode ?? '—' })}
                  checked={writeOnVehicle}
                  onChange={(e) => setWriteOnVehicle(e.target.checked)}
                />
              )}
            </div>
          )}
          {/* A known insurer the car does not carry yet — the same offer, without the catalog half. */}
          {!isNewInsurer &&
            knownInsurerId !== null &&
            knownInsurerId !== row.insuranceCompanyId &&
            knownInsurerId !== carInsurerId &&
            mayWriteVehicle && (
              <Checkbox
                data-dealership-write-insurer="true"
                label={t('fleet.dealership.insurerWriteOnCar', { code: row.vehicleCode ?? '—' })}
                checked={writeOnVehicle}
                onChange={(e) => setWriteOnVehicle(e.target.checked)}
              />
            )}
          {/* Who pays, in its state's colour: the dealership green, the custody fund amber. */}
          <p
            data-dealership-side={side ?? 'none'}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold',
              side === null &&
                'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300',
              side === 'dealership' &&
                'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200',
              side === 'custody' &&
                'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200',
            )}
          >
            <BoardIcon
              d={side === null ? PATH.warn : FILTER_ICON.status}
              className="h-4 w-4 shrink-0"
            />
            {side === null
              ? t('fleet.dealership.sideUnknown')
              : side === 'custody'
                ? t('fleet.dealership.sideCustodyHint')
                : t('fleet.dealership.sideDealershipHint')}
          </p>
        </div>
      )}
    </Dialog>
  );
};
