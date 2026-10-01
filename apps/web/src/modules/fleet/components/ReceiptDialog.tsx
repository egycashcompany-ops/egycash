// «إيصال جديد» — «بيكون فوق اختار وقود او كاوتش او غسيل»: the kind first, then the paper.
//
// A fuel receipt may be taken off one of the car's two cards («جمبها علامه صح معناها يسمح انى
// استخدم فيزا») or, with the tick off, from the custody fund; tyres and washing always come from
// the fund. The driver is read off the daily roster for the date and the car — and can be cleared
// and typed over («لو عاوز امسحه واكتب حد غيره عادى»). The litres are the amount priced by the
// fleet settings, shown as the clerk types.
import { useEffect, useMemo, useState } from 'react';
import {
  FLEET_FUEL_PRICE_KEY,
  FLEET_FUEL_TYPES,
  FLEET_RECEIPT_KINDS,
  type FleetFuelCardDto,
  type FleetFuelType,
  type FleetReceiptDto,
  type FleetReceiptKind,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useMySettings } from '../../../platform/settings/settings-api';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Select } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatMoney } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import {
  useAllFuelCards,
  useCreateReceipt,
  useRosterDay,
  useUpdateReceipt,
  useUploadReceiptImage,
  useVehicle,
} from '../api/fleet-queries';
import { useFleetPeopleMap } from './EmployeeName';
import { FuelCompanyLogo } from './FuelCardTiles';
import { LICENSE_IMAGE_ACCEPT } from './VehicleLicenseImage';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';

const today = (): string => new Date().toISOString().slice(0, 10);
const round = (value: number): number => Math.round(value * 100) / 100;

/** «وقود / كاوتش / غسيل» across the top. */
const KindSwitch = ({
  value,
  onChange,
}: {
  value: FleetReceiptKind;
  onChange: (kind: FleetReceiptKind) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      role="radiogroup"
      className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700"
    >
      {FLEET_RECEIPT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          role="radio"
          aria-checked={value === kind}
          data-receipt-kind={kind}
          onClick={() => onChange(kind)}
          className={cn(
            'rounded-md px-4 py-1.5 text-sm font-medium',
            value === kind
              ? 'bg-brand-600 text-white'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
          )}
        >
          {t(`fleet.receipts.kind.${kind}`)}
        </button>
      ))}
    </div>
  );
};

/** The car's two cards, one to pick — dimmed when the fund pays. */
const CardPick = ({
  cards,
  value,
  onChange,
  enabled,
}: {
  cards: readonly FleetFuelCardDto[];
  value: string;
  onChange: (id: string) => void;
  enabled: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className={cn('flex gap-3', !enabled && 'opacity-50')}>
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          data-receipt-card={card.id}
          aria-pressed={value === card.id}
          disabled={!enabled}
          onClick={() => onChange(card.id)}
          className={cn(
            'flex flex-1 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-start text-sm',
            value === card.id
              ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40'
              : 'border-slate-300 dark:border-slate-700',
          )}
        >
          <FuelCompanyLogo company={card.company} size="sm" />
          <span className="tabular-nums" dir="ltr">
            {card.number}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('fleet.fuelCards.fields.balance')}{' '}
            <b className="text-slate-800 dark:text-slate-100">
              {formatMoney(card.balance, 'EGP', locale)}
            </b>
          </span>
        </button>
      ))}
    </div>
  );
};

export const ReceiptDialog = ({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  /** The receipt being edited; `null` for a new one. */
  row: FleetReceiptDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [kind, setKind] = useState<FleetReceiptKind>('fuel');
  const [date, setDate] = useState(today());
  const [vehicleId, setVehicleId] = useState('');
  const [driver, setDriver] = useState('');
  // Whether the clerk has written in the driver box — a roster name never overwrites typing.
  const [driverTouched, setDriverTouched] = useState(false);
  const [useCard, setUseCard] = useState(true);
  const [cardId, setCardId] = useState('');
  const [fuelType, setFuelType] = useState<FleetFuelType>('petrol92');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    setKind(row?.kind ?? 'fuel');
    setDate(row === null ? today() : row.date.slice(0, 10));
    setVehicleId(row?.vehicleId ?? '');
    setDriver(row?.driverName ?? '');
    setDriverTouched(row !== null);
    setUseCard(row === null ? true : row.source === 'card');
    setCardId(row?.cardId ?? '');
    setFuelType(row?.fuelType ?? 'petrol92');
    setAmount(row === null ? '' : String(row.amount));
    setFile(null);
    setInputKey((k) => k + 1);
  }, [open, row]);

  // The car's cards — read by its code, which the registry resolves from the picked id.
  const vehicle = useVehicle(vehicleId);
  const code = vehicle.data?.id === vehicleId ? vehicle.data.code : '';
  const cards = useAllFuelCards({ vehicleCodes: [code] }, open && code !== '');
  const carCards = useMemo(
    () => (cards.data?.items ?? []).filter((card) => card.vehicleId === vehicleId),
    [cards.data, vehicleId],
  );
  useEffect(() => {
    // A card picked for another car is no card of this one.
    if (cardId !== '' && carCards.length > 0 && !carCards.some((card) => card.id === cardId)) {
      setCardId('');
    }
  }, [carCards, cardId]);

  // «اسم السائق — لو موجود فى اليوم دا»: the roster's first seat for the car on the date.
  const people = useFleetPeopleMap();
  const roster = useRosterDay(open && row === null && vehicleId !== '' ? date : '');
  const rosterDriver = useMemo(() => {
    const line = roster.data?.rows.find((r) => r.vehicleId === vehicleId);
    const employeeId = line?.driver1EmployeeId ?? null;
    return employeeId === null ? null : (people.get(employeeId)?.fullNameAr ?? null);
  }, [roster.data, vehicleId, people]);
  useEffect(() => {
    if (!driverTouched && rosterDriver !== null) setDriver(rosterDriver);
  }, [rosterDriver, driverTouched]);
  const names = useMemo(() => [...people.values()].map((p) => p.fullNameAr), [people]);
  const driverEmployeeId = useMemo(() => {
    const typed = driver.trim();
    if (typed === '') return null;
    return [...people.values()].find((p) => p.fullNameAr === typed)?.employeeId ?? null;
  }, [driver, people]);

  // The litres: the amount at the settings' price for the fuel type.
  const settings = useMySettings();
  const price = Number(
    settings.data?.find((s) => s.key === FLEET_FUEL_PRICE_KEY[fuelType])?.value ?? 0,
  );
  const value = Number(amount);
  const amountOk = amount !== '' && Number.isFinite(value) && value > 0;
  const litres = kind === 'fuel' && amountOk && price > 0 ? round(value / price) : null;

  const isFuel = kind === 'fuel';
  const byCard = isFuel && useCard;
  const card = byCard ? (carCards.find((c) => c.id === cardId) ?? null) : null;
  // On an edit, the card already holds this receipt's money back once the edit lands.
  const before = card === null ? 0 : card.balance + (row?.cardId === card.id ? row.amount : 0);
  const after = card === null ? 0 : round(before - value);
  const enough = !byCard || card === null || !amountOk || after >= 0;
  const complete =
    date !== '' && vehicleId !== '' && amountOk && (!byCard || card !== null) && enough;

  const create = useCreateReceipt();
  const update = useUpdateReceipt();
  const upload = useUploadReceiptImage();
  const pending = create.isPending || update.isPending || upload.isPending;
  const money = (n: number): string => formatMoney(n, 'EGP', locale);

  const submit = async (): Promise<void> => {
    const body = {
      date: new Date(`${date}T00:00:00.000Z`),
      vehicleId,
      driverEmployeeId,
      driverName: driver.trim() === '' ? null : driver.trim(),
      kind,
      cardId: byCard ? cardId : null,
      fuelType: isFuel ? fuelType : null,
      amount: value,
    };
    const saved =
      row === null
        ? await create.mutateAsync(body)
        : await update.mutateAsync({ id: row.id, body: { ...body, version: row.version } });
    if (file !== null) await upload.mutateAsync({ id: saved.id, file });
    toast.success(t('fleet.receipts.saved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      size="xl"
      tall
      title={row === null ? t('fleet.receipts.new') : t('fleet.receipts.edit')}
      description={t('fleet.receipts.newHint')}
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
        <KindSwitch value={kind} onChange={setKind} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('fleet.receipts.columns.date')} required>
            <Input
              type="date"
              dir="ltr"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-receipt-date="true"
            />
          </Field>
          <Field label={t('fleet.odometer.columns.vehicle')} required>
            <VehicleCodeCombobox
              value={vehicleId}
              onChange={setVehicleId}
              wholeRegistry
              anyStatus
              testId="receipt-vehicle"
            />
          </Field>
          <Field
            label={t('fleet.receipts.columns.driver')}
            hint={t('fleet.receipts.fields.driverHint')}
          >
            <Input
              list="receipt-drivers"
              value={driver}
              onChange={(e) => {
                setDriverTouched(true);
                setDriver(e.target.value);
              }}
              placeholder={t('fleet.receipts.fields.driverPlaceholder')}
              data-receipt-driver="true"
            />
            <datalist id="receipt-drivers">
              {names.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('fleet.receipts.fields.card')} className="sm:col-span-2">
            {vehicleId === '' ? (
              <p className="text-sm text-slate-400">{t('fleet.receipts.fields.pickCar')}</p>
            ) : carCards.length === 0 ? (
              <p className="text-sm text-slate-400">{t('fleet.receipts.fields.noCards')}</p>
            ) : (
              <CardPick cards={carCards} value={cardId} onChange={setCardId} enabled={byCard} />
            )}
            <div className="mt-2">
              <Checkbox
                data-receipt-use-card="true"
                label={
                  isFuel
                    ? useCard
                      ? t('fleet.receipts.fields.useCard')
                      : t('fleet.receipts.fields.noCardFund')
                    : t('fleet.receipts.fields.fundOnly')
                }
                checked={byCard}
                disabled={!isFuel}
                onChange={(e) => setUseCard(e.target.checked)}
              />
            </div>
          </Field>
          <div className="space-y-4">
            {isFuel && (
              <Field
                label={t('fleet.receipts.fields.fuelType')}
                hint={t('fleet.receipts.fields.pricePerLitre', { price: money(price) })}
              >
                <Select
                  value={fuelType}
                  onChange={(e) => setFuelType(e.target.value as FleetFuelType)}
                  data-receipt-fuel-type="true"
                >
                  {FLEET_FUEL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`fleet.receipts.fuelType.${type}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field
              label={t('fleet.receipts.columns.amount')}
              required
              {...(litres === null
                ? {}
                : {
                    hint: t('fleet.receipts.fields.litres', {
                      litres: litres.toFixed(2),
                    }),
                  })}
            >
              <MoneyInput value={amount} onChange={setAmount} data-receipt-amount="true" />
            </Field>
          </div>
        </div>
        <Field label={t('fleet.receipts.fields.image')} hint={t('fleet.receipts.fields.imageHint')}>
          <Input
            key={inputKey}
            type="file"
            accept={LICENSE_IMAGE_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-receipt-image="true"
          />
        </Field>
        <p
          data-receipt-source={byCard ? 'card' : 'custody'}
          className={cn(
            'rounded-md px-3 py-2 text-sm',
            byCard && !enough
              ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
          )}
        >
          {byCard
            ? card === null
              ? t('fleet.receipts.fields.pickCar')
              : !enough
                ? t('fleet.receipts.summary.notEnough', { balance: money(card.balance) })
                : t('fleet.receipts.summary.card', {
                    company: t(`fleet.fuelCards.company.${card.company}`),
                    code,
                    before: money(before),
                    after: money(amountOk ? after : before),
                  })
            : t('fleet.receipts.summary.custody', { amount: money(amountOk ? value : 0) })}
        </p>
      </div>
    </Dialog>
  );
};
