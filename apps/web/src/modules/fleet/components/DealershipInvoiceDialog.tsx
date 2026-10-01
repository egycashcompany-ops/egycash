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
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate, localized } from '../../../shared/lib/format';
import {
  useCreateCatalogItem,
  useFleetCatalog,
  useUpdateDealershipInvoice,
  useUpdateVehicle,
  useVehicle,
} from '../api/fleet-queries';

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
  const [addToCatalog, setAddToCatalog] = useState(true);
  const [writeOnVehicle, setWriteOnVehicle] = useState(true);

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
    setInsurer(row.insuranceCompanyName ?? '');
    setAddToCatalog(true);
    setWriteOnVehicle(true);
  }, [open, row]);

  const update = useUpdateDealershipInvoice();
  const createInsurer = useCreateCatalogItem();
  const updateVehicle = useUpdateVehicle();
  const pending = update.isPending || createInsurer.isPending || updateVehicle.isPending;

  const typedInsurer = insurer.trim();
  const knownInsurerId = typedInsurer === '' ? null : (byName.get(typedInsurer) ?? null);
  const isNewInsurer = typedInsurer !== '' && knownInsurerId === null;
  const mayAddInsurer = can('fleetCatalog.manage');
  // Writing the insurer onto the car is an edit of the VEHICLE record, which is versioned — so
  // the car is read first, and the offer is only made once its version is in hand.
  const vehicle = useVehicle(open && row?.vehicleId != null ? row.vehicleId : '');
  const mayWriteVehicle =
    can('fleetVehicle.edit') && row?.vehicleId != null && vehicle.data !== undefined;

  const amount = Number(invoiceAmount);
  const amountOk = invoiceAmount !== '' && Number.isFinite(amount) && amount >= 0;
  const numberOk = privateCar || invoiceNumber.trim() !== '';
  // A new insurer the clerk may not add has nowhere to go — the row cannot point at a name.
  const insurerOk = !isNewInsurer || (mayAddInsurer && addToCatalog);
  const complete = row !== null && amountOk && numberOk && insurerOk;
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
          <Button loading={pending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {row !== null && (
        <div className="space-y-4">
          {/* The grey facts: what the workshop knew. Read, not written. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('fleet.dealership.columns.outDate')}>
              <Input value={formatDate(row.outDate, locale)} readOnly disabled />
            </Field>
            <Field label={t('fleet.odometer.columns.vehicle')}>
              <Input value={row.vehicleCode ?? '—'} readOnly disabled />
            </Field>
            <Field label={t('fleet.dealership.columns.workType')}>
              <Input value={row.workTypeLabel} readOnly disabled />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={t('fleet.vehicles.fields.insuranceCompany')}
              hint={
                row.insuranceCompanyName === null
                  ? t('fleet.dealership.insurerNone')
                  : t('fleet.dealership.insurerFromCar')
              }
            >
              <Input
                list="dealership-insurers"
                value={insurer}
                onChange={(e) => setInsurer(e.target.value)}
                placeholder={t('fleet.dealership.insurerPlaceholder')}
                data-dealership-insurer="true"
              />
              <datalist id="dealership-insurers">
                {names.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
            <Field
              label={t('fleet.dealership.privateCar')}
              hint={t('fleet.dealership.privateCarHint')}
            >
              <div className="flex h-10 items-center">
                <Checkbox
                  data-dealership-private="true"
                  label={t('fleet.dealership.privateCar')}
                  checked={privateCar}
                  onChange={(e) => setPrivateCar(e.target.checked)}
                />
              </div>
            </Field>
            <Field label={t('fleet.dealership.columns.invoiceAmount')} required>
              <MoneyInput value={invoiceAmount} onChange={setInvoiceAmount} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={t('fleet.dealership.columns.invoiceNumber')}
              required={!privateCar}
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
            mayWriteVehicle && (
              <Checkbox
                data-dealership-write-insurer="true"
                label={t('fleet.dealership.insurerWriteOnCar', { code: row.vehicleCode ?? '—' })}
                checked={writeOnVehicle}
                onChange={(e) => setWriteOnVehicle(e.target.checked)}
              />
            )}
          <p
            data-dealership-side={side ?? 'none'}
            className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
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
