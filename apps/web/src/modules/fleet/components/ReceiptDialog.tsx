// «إيصال جديد» — «بيكون فوق اختار وقود او كاوتش او غسيل»: the kind first, then the paper.
//
// A fuel receipt may be taken off one of the car's two cards («جمبها علامه صح معناها يسمح انى
// استخدم فيزا») or, with the tick off, from the custody fund; tyres and washing always come from
// the fund. «هل تريد تسجيل كارت اخر حتى لو العربيه عليها كروت»: once a car is picked, ANY other
// card may pay instead — another car's, or one on no car («سفر 1») — searched and picked under the
// car's own, and offered on a car with no card too. The driver is read off the daily roster for
// the date and the car — and can be cleared and typed over («لو عاوز امسحه واكتب حد غيره عادى»).
// The litres are the amount priced by the fleet settings, shown as the clerk types; «نوع الوقود»
// opens on «سولار» («سولار افتراضى»), and «كم» — the odometer at the pump — is the paper's own,
// optional («اختيارى عند كتابه مبلغ التفويل»).
//
// «حسن الui … بالفورم بتاعت التسجيل والتعديل»: the vehicle form's design (`DesignDialog`) around the
// same fields, rules, required marks and hooks as before.
import { useEffect, useMemo, useState } from 'react';
import { PhotoSourceButtons } from '../../../shared/ui/PhotoPick';
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
import { Checkbox, Input, Select } from '../../../shared/ui/form';
import {
  MissingFieldsBanner,
  useFieldMissing,
  useRequiredFields,
} from '../../../shared/ui/required-fields';
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
import { DriverNameCombobox } from './DriverPerson';
import { FuelCompanyLogo } from './FuelCardTiles';
import { LICENSE_IMAGE_ACCEPT } from './VehicleLicenseImage';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { DesignField, LOOK, MONO, Stroke, boxTone, carBoxClass } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import {
  cardPlace,
  otherReceiptCards,
  paidByOtherCard,
  receiptCardsState,
  settleReceiptCard,
} from '../lib/receipt-cards';
import { groupCardNumber, maskCardNumber } from '../lib/fuel-card-number';
import { saveThenAttachPhoto } from '../lib/save-with-photo';

const today = (): string => new Date().toISOString().slice(0, 10);
const round = (value: number): number => Math.round(value * 100) / 100;
/** «نوع الوقود (سولار افتراضى)»: what a NEW receipt opens on; an edit keeps the type it has. */
export const DEFAULT_FUEL_TYPE: FleetFuelType = 'diesel';

/** The header's drawing: a till receipt. */
const RECEIPT_PATH = [
  'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
] as const;

/** A note in the card's place — no car yet, loading, none: the design's quiet dashed box. */
const CARD_NOTE =
  'rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium dark:border-[#2b3b6b] dark:bg-[#0a1233]/60';

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
      className="inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 shadow-inner dark:border-[#2b3b6b] dark:bg-[#0a1233]"
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
            'rounded-lg px-5 py-2 text-[15px] font-bold transition-all active:scale-[0.98]',
            // The picked kind in the site's purple — what is pressed, nothing else.
            value === kind
              ? 'bg-brand-600 text-white shadow-md shadow-brand-700/30'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white',
          )}
        >
          {t(`fleet.receipts.kind.${kind}`)}
        </button>
      ))}
    </div>
  );
};

/** The car's two cards, one to pick — dimmed when the fund pays. */
export const CardPick = ({
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
  // A `Field` marked missing turns the cards red, as it does a box — they are buttons, not an
  // `Input`, so they read the mark themselves.
  const missing = useFieldMissing();
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
            'flex flex-1 flex-col items-start gap-1.5 rounded-xl border-2 px-4 py-3 text-start text-sm transition-all',
            // The picked card in the site's purple; the others the form's boxes.
            value === card.id
              ? 'bg-brand-500/10 shadow-md shadow-brand-700/20'
              : 'bg-slate-50 hover:bg-slate-100 dark:bg-[#0a1233] dark:hover:bg-slate-800/60',
            missing
              ? 'border-red-400'
              : value === card.id
                ? 'border-brand-500'
                : 'border-slate-200 dark:border-[#2b3b6b]',
          )}
        >
          <FuelCompanyLogo company={card.company} size="sm" />
          <span
            className={cn('text-[15px] font-bold text-slate-900 dark:text-white', MONO)}
            dir="ltr"
          >
            {groupCardNumber(card.number)}
          </span>
          <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
            {t('fleet.fuelCards.fields.balance')}{' '}
            <b className={cn('text-slate-900 dark:text-white', MONO)}>
              {formatMoney(card.balance, 'EGP', locale)}
            </b>
          </span>
        </button>
      ))}
    </div>
  );
};

/** The «تسجيل كارت آخر؟» press, and «رجوع لكروت السيارة» — an action, in the dialog's indigo. */
const OTHER_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm font-bold text-indigo-700 transition hover:bg-indigo-500/20 active:scale-[0.98] dark:text-indigo-300';

/**
 * «كارت آخر» — every card that is not on the receipt's car, searched by the car's code, the card's
 * name, its number or the company; each row its company, its number's end, where it sits (its car
 * «كارت 160» or its name on no car «سفر 1») and its balance. The picked one in the site's purple.
 */
export const OtherCardPick = ({
  cards,
  status,
  value,
  onChange,
  search,
  onSearch,
  enabled,
  tone,
}: {
  /** The candidates, already narrowed by `search`. */
  cards: readonly FleetFuelCardDto[];
  status: 'loading' | 'failed' | 'ready';
  value: string;
  onChange: (id: string) => void;
  search: string;
  onSearch: (text: string) => void;
  enabled: boolean;
  /** The form's box, for the search. */
  tone: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const missing = useFieldMissing();
  return (
    <div className={cn('space-y-3', !enabled && 'opacity-50')} data-receipt-other-cards={status}>
      <Input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t('fleet.receipts.otherCard.search')}
        aria-label={t('fleet.receipts.otherCard.search')}
        data-receipt-other-search="true"
        disabled={!enabled}
        tone={tone}
      />
      {status === 'loading' ? (
        <p className={cn(CARD_NOTE, 'text-slate-500 dark:text-slate-400')}>
          {t('fleet.receipts.otherCard.loading')}
        </p>
      ) : status === 'failed' ? (
        <p className={cn(CARD_NOTE, 'text-red-600 dark:text-red-400')}>
          {t('fleet.receipts.otherCard.failed')}
        </p>
      ) : cards.length === 0 ? (
        <p className={cn(CARD_NOTE, 'text-slate-500 dark:text-slate-400')}>
          {t('fleet.receipts.otherCard.none')}
        </p>
      ) : (
        <div role="listbox" className="max-h-64 space-y-2 overflow-y-auto pe-1">
          {cards.map((card) => {
            const chosen = value === card.id;
            return (
              <button
                key={card.id}
                type="button"
                role="option"
                aria-selected={chosen}
                data-receipt-other-card={card.id}
                disabled={!enabled}
                onClick={() => onChange(card.id)}
                className={cn(
                  'flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border-2 px-3 py-2.5 text-start text-sm transition-all',
                  // The picked card in the site's purple; the others the form's boxes.
                  chosen
                    ? 'bg-brand-500/10 shadow-md shadow-brand-700/20'
                    : 'bg-slate-50 hover:bg-slate-100 dark:bg-[#0a1233] dark:hover:bg-slate-800/60',
                  missing
                    ? 'border-red-400'
                    : chosen
                      ? 'border-brand-500'
                      : 'border-slate-200 dark:border-[#2b3b6b]',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FuelCompanyLogo company={card.company} size="sm" />
                  <span className="font-bold text-slate-900 dark:text-white">
                    {t(`fleet.fuelCards.company.${card.company}`)}
                  </span>
                  <span className={cn('text-slate-700 dark:text-slate-300', MONO)} dir="ltr">
                    {maskCardNumber(card.number)}
                  </span>
                </span>
                <span
                  data-receipt-other-place="true"
                  className="whitespace-nowrap rounded-md bg-slate-200/70 px-2 py-0.5 text-[13px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {card.vehicleId === null
                    ? cardPlace(card)
                    : t('fleet.receipts.cardOf', { code: cardPlace(card) })}
                </span>
                <span className="whitespace-nowrap text-[13px] font-medium text-slate-600 dark:text-slate-300">
                  {t('fleet.fuelCards.fields.balance')}{' '}
                  <b className={cn('text-slate-900 dark:text-white', MONO)}>
                    {formatMoney(card.balance, 'EGP', locale)}
                  </b>
                </span>
              </button>
            );
          })}
        </div>
      )}
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
  // Seeded from the row on the first paint — an edit never flashes an empty form — and reset on
  // every open by the effect below.
  const [kind, setKind] = useState<FleetReceiptKind>(row?.kind ?? 'fuel');
  const [date, setDate] = useState(row === null ? today() : row.date.slice(0, 10));
  const [vehicleId, setVehicleId] = useState(row?.vehicleId ?? '');
  const [driver, setDriver] = useState(row?.driverName ?? '');
  // Whether the clerk has written in the driver box — a roster name never overwrites typing.
  const [driverTouched, setDriverTouched] = useState(row !== null);
  const [useCard, setUseCard] = useState(row === null ? true : row.source === 'card');
  const [cardId, setCardId] = useState(row?.cardId ?? '');
  // «كارت آخر»: the card pays from outside the car's own — an edit of such a receipt opens on it.
  const [other, setOther] = useState(row !== null && paidByOtherCard(row));
  const [search, setSearch] = useState('');
  const [fuelType, setFuelType] = useState<FleetFuelType>(row?.fuelType ?? DEFAULT_FUEL_TYPE);
  const [amount, setAmount] = useState(row === null ? '' : String(row.amount));
  const [odometer, setOdometer] = useState(row?.odometer == null ? '' : String(row.odometer));
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
    setOther(row !== null && paidByOtherCard(row));
    setSearch('');
    setFuelType(row?.fuelType ?? DEFAULT_FUEL_TYPE);
    setAmount(row === null ? '' : String(row.amount));
    setOdometer(row?.odometer == null ? '' : String(row.odometer));
    setFile(null);
    setInputKey((k) => k + 1);
  }, [open, row]);

  // The car's cards — read by its code, which the registry resolves from the picked id.
  const vehicle = useVehicle(vehicleId);
  const code = vehicle.data?.id === vehicleId ? vehicle.data.code : '';
  const cards = useAllFuelCards({ vehicleCodes: [code] }, open && code !== '');
  // No car, loading, failed, or the car's own cards — see `receiptCardsState`.
  const cardsState = useMemo(
    () =>
      receiptCardsState({
        vehicleId,
        code,
        items: cards.data?.items,
        placeholder: cards.isPlaceholderData,
        failed: cards.isError || vehicle.isError,
      }),
    [vehicleId, code, cards.data, cards.isPlaceholderData, cards.isError, vehicle.isError],
  );
  const carCards = cardsState.kind === 'ready' ? cardsState.cards : [];
  // «مفيش» — a car with no card of its own: the custody fund pays, unless «كارت آخر» does.
  const noCards = cardsState.kind === 'ready' && carCards.length === 0;
  useEffect(() => {
    // The only card is picked on its own; a card left from another car is dropped — but never the
    // one picked under «كارت آخر» (`settleReceiptCard`).
    const next = settleReceiptCard(cardsState, { other, cardId });
    if (next.cardId !== cardId) setCardId(next.cardId);
    if (next.other !== other) setOther(next.other);
  }, [cardsState, cardId, other]);

  // «كارت آخر» — every card in the system, read only once the clerk asks for one.
  const isFuel = kind === 'fuel';
  const allCards = useAllFuelCards({}, open && isFuel && other);
  const otherStatus: 'loading' | 'failed' | 'ready' = allCards.isError
    ? 'failed'
    : allCards.data === undefined
      ? 'loading'
      : 'ready';
  const otherCards = useMemo(
    () =>
      otherReceiptCards(allCards.data?.items ?? [], vehicleId, search, (company) =>
        t(`fleet.fuelCards.company.${company}`),
      ),
    [allCards.data, vehicleId, search, t],
  );
  const openOther = (): void => {
    setOther(true);
    setUseCard(true);
    setCardId('');
    setSearch('');
  };
  const backToOwn = (): void => {
    setOther(false);
    setCardId('');
  };

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

  const byCard = isFuel && useCard && (other || !noCards);
  const card = !byCard
    ? null
    : other
      ? (allCards.data?.items.find((c) => c.id === cardId) ?? null)
      : (carCards.find((c) => c.id === cardId) ?? null);
  // On an edit, the card already holds this receipt's money back once the edit lands.
  const before = card === null ? 0 : card.balance + (row?.cardId === card.id ? row.amount : 0);
  const after = card === null ? 0 : round(before - value);
  const enough = !byCard || card === null || !amountOk || after >= 0;
  // Save stays pressable: pressing it short of these names them and turns their boxes red
  // (`useRequiredFields`). The card is asked for only when it pays; an amount the card cannot cover
  // is the amount's, and the line under the form still says how much the card holds.
  const required = useRequiredFields(
    [
      { key: 'date', label: t('fleet.receipts.columns.date'), ok: date !== '' },
      { key: 'vehicle', label: t('fleet.odometer.columns.vehicle'), ok: vehicleId !== '' },
      { key: 'card', label: t('fleet.receipts.fields.card'), ok: !byCard || card !== null },
      { key: 'amount', label: t('fleet.receipts.columns.amount'), ok: amountOk && enough },
    ],
    open,
  );

  const create = useCreateReceipt();
  const update = useUpdateReceipt();
  const upload = useUploadReceiptImage();
  const pending = create.isPending || update.isPending || upload.isPending;
  const money = (n: number): string => formatMoney(n, 'EGP', locale);

  // The line under the form: where the money comes from, or what is still missing to know. A card
  // is named by where it sits — this car's code, another car's, or a card's name on no car.
  type Summary = { key: string; tone: 'plain' | 'ask' | 'bad'; text: string };
  const summaryLine = (): Summary => {
    if (!byCard) {
      return {
        key: 'custody',
        tone: 'plain',
        text: t('fleet.receipts.summary.custody', { amount: money(amountOk ? value : 0) }),
      };
    }
    // «كارت آخر» waits on every card in the system; the car's own on the car's.
    if (other && otherStatus === 'loading') {
      return { key: 'loadingOther', tone: 'plain', text: t('fleet.receipts.otherCard.loading') };
    }
    if (other && otherStatus === 'failed') {
      return { key: 'failedOther', tone: 'bad', text: t('fleet.receipts.otherCard.failed') };
    }
    if (!other && cardsState.kind === 'noCar') {
      return { key: 'noCar', tone: 'plain', text: t('fleet.receipts.fields.pickCar') };
    }
    if (!other && cardsState.kind === 'loading') {
      return { key: 'loading', tone: 'plain', text: t('fleet.receipts.fields.loadingCards') };
    }
    if (!other && cardsState.kind === 'failed') {
      return { key: 'failed', tone: 'bad', text: t('fleet.receipts.fields.cardsFailed') };
    }
    if (card === null) {
      return other
        ? { key: 'pickOther', tone: 'ask', text: t('fleet.receipts.otherCard.pick') }
        : { key: 'pickCard', tone: 'ask', text: t('fleet.receipts.summary.pickCard') };
    }
    if (!enough) {
      return {
        key: 'notEnough',
        tone: 'bad',
        text: t('fleet.receipts.summary.notEnough', { balance: money(card.balance) }),
      };
    }
    return {
      key: 'card',
      tone: 'plain',
      text: t('fleet.receipts.summary.card', {
        company: t(`fleet.fuelCards.company.${card.company}`),
        code: cardPlace(card),
        before: money(before),
        after: money(amountOk ? after : before),
      }),
    };
  };
  const summary = summaryLine();

  // «كم» belongs to a fuel paper: a receipt that turns into tyres or washing drops it.
  const changeKind = (next: FleetReceiptKind): void => {
    setKind(next);
    if (next !== 'fuel') setOdometer('');
  };

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
      // «كم» is a fuel paper's, and optional — empty sends none (an edit clears it).
      odometer: isFuel && odometer !== '' ? Number(odometer) : null,
    };
    // The photo goes up once the receipt exists. The receipt has already taken its money off the
    // card by then, so a refused photo must not leave the form open for a second Save — that would
    // record the receipt twice (`saveThenAttachPhoto`): say it is saved without its photo, close.
    const { photo } = await saveThenAttachPhoto(
      () =>
        row === null
          ? create.mutateAsync(body)
          : update.mutateAsync({ id: row.id, body: { ...body, version: row.version } }),
      file,
      (id, picked) => upload.mutateAsync({ id, file: picked }),
    );
    if (photo === 'failed') toast.warning(t('fleet.receipts.image.notUploaded'));
    else toast.success(t('fleet.receipts.saved'));
    onClose();
  };

  // The design's boxes: a date's ends are kept clear by `DesignField`'s `datePicker`; an amount
  // reads left to right, held at the box's right edge, clear of the «!» a refused box draws.
  const box = boxTone(LOOK.add);
  const dateBox = cn(box, MONO);
  const amountBox = cn(box, MONO, 'text-right');
  // «كم» reads as the amount does: Latin digits, left to right, at the box's right edge.
  const numberBox = cn(box, MONO, 'text-right');
  // A `<select>` takes no tone of its own — the same box, forced over the control's base.
  const selectBox = cn(
    '!h-auto !rounded-xl !py-3 !ps-4 !text-[15px] !font-medium !text-slate-900 dark:!text-white focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500',
    '!border-slate-200 !bg-slate-50 dark:!border-[#2b3b6b] dark:!bg-[#0a1233]',
  );
  const vehicleMissing = required.isMissing('vehicle');

  return (
    // A form: the design's backdrop has no click of its own — the ✕, «إلغاء» and Escape close it.
    <DesignDialog
      open={open}
      onClose={onClose}
      title={row === null ? t('fleet.receipts.new') : t('fleet.receipts.edit')}
      subtitle={t('fleet.receipts.newHint')}
      icon={RECEIPT_PATH}
      width="3xl"
      panelProps={{ 'data-receipt-form': row === null ? 'new' : 'edit' }}
      footer={
        <>
          <DesignSave data-receipt-save="true" busy={pending} onClick={required.guard(submit)} />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
      <DesignSection title={t('fleet.receipts.form.sections.receipt')} icon={PATH.truck}>
        <KindSwitch value={kind} onChange={changeKind} />
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-3">
          <DesignField
            label={t('fleet.receipts.columns.date')}
            required
            missing={required.isMissing('date')}
            datePicker
          >
            <Input
              type="date"
              dir="ltr"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-receipt-date="true"
              tone={dateBox}
            />
          </DesignField>
          <DesignField
            label={t('fleet.odometer.columns.vehicle')}
            required
            missing={vehicleMissing}
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
                onChange={setVehicleId}
                anyStatus
                testId="receipt-vehicle"
              />
            </div>
          </DesignField>
          <DesignField
            label={t('fleet.receipts.columns.driver')}
            hint={t('fleet.receipts.fields.driverHint')}
          >
            {/* «تحسين اختيار السواقيين»: still a NAME box — typed, or picked off Fleet's roster, which
                opens under it narrowed by what is typed (name or code), each person with the
                drivers board's badge and code. A pick writes the person's name in, as typing would;
                the employee id is resolved from the name above, as before. */}
            <DriverNameCombobox
              value={driver}
              onChange={(name) => {
                setDriverTouched(true);
                setDriver(name);
              }}
              input={(props) => (
                <Input
                  {...props}
                  value={driver}
                  onChange={(e) => {
                    setDriverTouched(true);
                    setDriver(e.target.value);
                  }}
                  placeholder={t('fleet.receipts.fields.driverPlaceholder')}
                  data-receipt-driver="true"
                  rule="arabic"
                  tone={box}
                />
              )}
            />
          </DesignField>
        </div>
      </DesignSection>

      <DesignSection title={t('fleet.receipts.columns.source')} icon={PATH.card}>
        <DesignField
          label={t('fleet.receipts.fields.card')}
          required={byCard}
          missing={required.isMissing('card')}
          // The cards are tiles, not a box: no «!» laid over them — the line under says it.
          endAdornment={null}
        >
          {other && isFuel ? (
            <div className="space-y-3" data-receipt-other="true">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {t('fleet.receipts.otherCard.title')}
                </span>
                <button
                  type="button"
                  data-receipt-other-back="true"
                  onClick={backToOwn}
                  className={OTHER_BUTTON}
                >
                  {t('fleet.receipts.otherCard.back')}
                </button>
              </div>
              <OtherCardPick
                cards={otherCards}
                status={otherStatus}
                value={cardId}
                onChange={setCardId}
                search={search}
                onSearch={setSearch}
                enabled={byCard}
                tone={box}
              />
            </div>
          ) : cardsState.kind === 'noCar' ? (
            <p className={cn(CARD_NOTE, 'text-slate-500 dark:text-slate-400')}>
              {t('fleet.receipts.fields.pickCar')}
            </p>
          ) : cardsState.kind === 'loading' ? (
            <p
              data-receipt-cards="loading"
              className={cn(CARD_NOTE, 'text-slate-500 dark:text-slate-400')}
            >
              {t('fleet.receipts.fields.loadingCards')}
            </p>
          ) : cardsState.kind === 'failed' ? (
            <p
              data-receipt-cards="failed"
              className={cn(CARD_NOTE, 'text-red-600 dark:text-red-400')}
            >
              {t('fleet.receipts.fields.cardsFailed')}
            </p>
          ) : noCards ? (
            <p
              data-receipt-cards="none"
              className={cn(CARD_NOTE, 'text-slate-500 dark:text-slate-400')}
            >
              {t('fleet.receipts.fields.noCards')}
            </p>
          ) : (
            <CardPick cards={carCards} value={cardId} onChange={setCardId} enabled={byCard} />
          )}
          {/* «هل تريد تسجيل كارت اخر حتى لو العربيه عليها كروت»: once the car's cards are known,
              any other card is on offer — with cards on the car and without. */}
          {!other && isFuel && cardsState.kind === 'ready' && (
            <div className="mt-3">
              <button
                type="button"
                data-receipt-other-open="true"
                onClick={openOther}
                className={OTHER_BUTTON}
              >
                <Stroke d={[...PATH.card]} className="h-4 w-4" />
                {t('fleet.receipts.otherCard.open')}
              </button>
            </div>
          )}
          <div className="mt-3">
            <Checkbox
              className="font-semibold"
              data-receipt-use-card="true"
              label={
                !isFuel
                  ? t('fleet.receipts.fields.fundOnly')
                  : noCards && !other
                    ? t('fleet.receipts.fields.noCardCustody')
                    : useCard
                      ? t('fleet.receipts.fields.useCard')
                      : t('fleet.receipts.fields.noCardFund')
              }
              checked={byCard}
              disabled={!isFuel || (noCards && !other)}
              onChange={(e) => setUseCard(e.target.checked)}
            />
          </div>
        </DesignField>
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-3">
          {isFuel && (
            <DesignField
              label={t('fleet.receipts.fields.fuelType')}
              hint={t('fleet.receipts.fields.pricePerLitre', { price: money(price) })}
            >
              <Select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value as FleetFuelType)}
                data-receipt-fuel-type="true"
                className={selectBox}
              >
                {FLEET_FUEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`fleet.receipts.fuelType.${type}`)}
                  </option>
                ))}
              </Select>
            </DesignField>
          )}
          <DesignField
            label={t('fleet.receipts.columns.amount')}
            required
            missing={required.isMissing('amount')}
            hint={
              litres === null
                ? undefined
                : t('fleet.receipts.fields.litres', { litres: litres.toFixed(2) })
            }
            // Typed, but more than the card holds: say so rather than «required».
            error={
              required.isMissing('amount') && amountOk && card !== null && !enough
                ? t('fleet.receipts.summary.notEnough', { balance: money(card.balance) })
                : undefined
            }
          >
            <MoneyInput
              value={amount}
              onChange={setAmount}
              data-receipt-amount="true"
              tone={amountBox}
            />
          </DesignField>
          {/* «ادخال كم (اختيارى عند كتابه مبلغ التفويل)»: beside the amount, fuel only, never
              required — the receipt's own, not a reading on the odometer screen. */}
          {isFuel && (
            <DesignField
              label={t('fleet.receipts.fields.odometer')}
              hint={t('fleet.receipts.fields.odometerHint')}
            >
              <Input
                rule="integer"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                dir="ltr"
                data-receipt-odometer="true"
                tone={numberBox}
              />
            </DesignField>
          )}
        </div>
      </DesignSection>

      <DesignSection title={t('fleet.receipts.fields.image')} icon={PATH.image}>
        {/* The vehicle form's dashed box: the whole box is the file picker. */}
        <div className="group relative cursor-pointer rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 transition-all hover:border-indigo-500/50 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60 dark:hover:bg-[#0a1233]">
          <input
            key={inputKey}
            type="file"
            accept={LICENSE_IMAGE_ACCEPT}
            aria-label={t('fleet.receipts.fields.image')}
            title={t('fleet.receipts.fields.image')}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-receipt-image="true"
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          />
          <div className="pointer-events-none flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-500 transition-transform group-hover:scale-105 dark:text-indigo-400">
                <Stroke d={[...PATH.image]} className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                  {file === null ? t('fleet.receipts.image.upload') : file.name}
                </p>
                <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                  {t('fleet.receipts.fields.imageHint')}
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm font-bold text-indigo-700 transition group-hover:bg-indigo-500/20 dark:text-indigo-300">
              {t('fleet.fuelCards.image.pick')}
            </span>
          </div>
        </div>
        <PhotoSourceButtons accept={LICENSE_IMAGE_ACCEPT} onFile={setFile} />
      </DesignSection>

      <p
        data-receipt-source={byCard ? 'card' : 'custody'}
        data-receipt-summary={summary.key}
        className={cn(
          'rounded-xl border px-4 py-3 text-sm font-semibold',
          summary.tone === 'bad' &&
            'border-red-500/30 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200',
          summary.tone === 'ask' &&
            'border-amber-500/30 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
          summary.tone === 'plain' &&
            'border-slate-200 bg-slate-100 text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-slate-200',
        )}
      >
        {summary.text}
      </p>
    </DesignDialog>
  );
};
