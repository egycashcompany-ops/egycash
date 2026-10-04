// «تحويل رصيد بين كارتين»: pick a car and one of its two cards (from), a car and a card (to), the
// amount — and see what each card was and what it becomes before pressing the button.
import { useEffect, useMemo, useState } from 'react';
import { type FleetFuelCardDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field } from '../../../shared/ui/form';
import {
  MissingFieldsBanner,
  useFieldMissing,
  useRequiredFields,
} from '../../../shared/ui/required-fields';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatMoney } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useTransferFuelBalance } from '../api/fleet-queries';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { FuelCompanyLogo, fuelCardPlace, noCarPlaces } from './FuelCardTiles';

export const CardPick = ({
  cards,
  value,
  onChange,
  side,
  emptyText,
}: {
  cards: readonly FleetFuelCardDto[];
  value: string;
  onChange: (id: string) => void;
  side: 'from' | 'to';
  /** What an empty list says — «pick a car» unless the caller knows better. */
  emptyText?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // A `Field` marked missing turns the cards red, as it does a box — they are buttons, not an
  // `Input`, so they read the mark themselves.
  const missing = useFieldMissing();
  if (cards.length === 0) {
    return (
      <p className={cn('text-sm', missing ? 'text-red-600 dark:text-red-400' : 'text-slate-400')}>
        {emptyText ?? t('fleet.fuelCards.transfer.pickCar')}
      </p>
    );
  }
  return (
    <div className="flex gap-3">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          data-fuel-transfer-card={`${side}:${card.id}`}
          aria-pressed={value === card.id}
          onClick={() => onChange(card.id)}
          className={cn(
            'flex flex-1 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-start text-sm',
            value === card.id && 'bg-brand-50 dark:bg-brand-950/40',
            missing
              ? 'border-red-400'
              : value === card.id
                ? 'border-brand-500'
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

export const FuelTransferDialog = ({
  open,
  onClose,
  cards,
}: {
  open: boolean;
  onClose: () => void;
  /** Every card on the screen — the cars' cards are picked out of it. */
  cards: readonly FleetFuelCardDto[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [fromVehicle, setFromVehicle] = useState('');
  const [toVehicle, setToVehicle] = useState('');
  const [fromCard, setFromCard] = useState('');
  const [toCard, setToCard] = useState('');
  const [amount, setAmount] = useState('');
  useEffect(() => {
    if (!open) return;
    setFromVehicle('');
    setToVehicle('');
    setFromCard('');
    setToCard('');
    setAmount('');
  }, [open]);
  useEffect(() => setFromCard(''), [fromVehicle]);
  useEffect(() => setToCard(''), [toVehicle]);

  // A «car» here is a car's id, or the label of cards on no car — they are picked the same way.
  const byVehicle = (vehicleId: string): FleetFuelCardDto[] =>
    vehicleId === '' ? [] : cards.filter((card) => fuelCardPlace(card) === vehicleId);
  const places = useMemo(() => noCarPlaces(cards), [cards]);
  // «لازم تكون نفس الشركه … وطنيه ل وطنيه ومينفعش وطنيه ل شيل اوت والعكس صحيح»: once the first
  // card is chosen, the second is offered from its company only.
  const fromCompany = cards.find((card) => card.id === fromCard)?.company ?? null;
  const toChoices = byVehicle(toVehicle).filter(
    (card) => fromCompany === null || card.company === fromCompany,
  );
  // A first card of the other company makes a chosen second card unreachable — it is dropped.
  useEffect(() => {
    if (fromCompany === null) return;
    const chosen = cards.find((card) => card.id === toCard);
    if (chosen !== undefined && chosen.company !== fromCompany) setToCard('');
  }, [fromCompany, toCard, cards]);
  const from = useMemo(() => cards.find((card) => card.id === fromCard) ?? null, [cards, fromCard]);
  const to = useMemo(() => cards.find((card) => card.id === toCard) ?? null, [cards, toCard]);
  const value = Number(amount);
  const valid =
    from !== null &&
    to !== null &&
    from.id !== to.id &&
    from.company === to.company &&
    Number.isFinite(value) &&
    value > 0;
  const enough = from !== null && value <= from.balance;
  const money = (n: number): string => formatMoney(n, 'EGP', locale);
  // The button stays pressable: pressing it short of a valid transfer names what is missing and
  // turns it red (`useRequiredFields`). The same card on both sides is the «to» card's fault; more
  // than the first card holds is the amount's, which keeps its own «not enough» line.
  const required = useRequiredFields(
    [
      {
        key: 'fromVehicle',
        label: `${t('fleet.fuelCards.transfer.from')} · ${t('fleet.odometer.columns.vehicle')}`,
        ok: fromVehicle !== '',
      },
      {
        key: 'fromCard',
        label: `${t('fleet.fuelCards.transfer.from')} · ${t('fleet.fuelCards.fields.card')}`,
        ok: from !== null,
      },
      {
        key: 'toVehicle',
        label: `${t('fleet.fuelCards.transfer.to')} · ${t('fleet.odometer.columns.vehicle')}`,
        ok: toVehicle !== '',
      },
      {
        key: 'toCard',
        label: `${t('fleet.fuelCards.transfer.to')} · ${t('fleet.fuelCards.fields.card')}`,
        ok: to !== null && to.id !== from?.id && (from === null || to.company === from.company),
      },
      {
        key: 'amount',
        label: t('fleet.fuelCards.transfer.amount'),
        ok: Number.isFinite(value) && value > 0 && (from === null || enough),
      },
    ],
    open,
  );

  const transfer = useTransferFuelBalance();
  const submit = async (): Promise<void> => {
    if (from === null || to === null) return;
    await transfer.mutateAsync({ fromCardId: from.id, toCardId: to.id, amount: value });
    toast.success(t('fleet.fuelCards.transfer.done'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      size="lg"
      tall
      title={t('fleet.fuelCards.transfer.title')}
      description={t('fleet.fuelCards.transfer.hint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={transfer.isPending} onClick={required.guard(submit)}>
            {t('fleet.fuelCards.transfer.action')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <section className="space-y-3">
          <h3 className="border-b border-slate-200 pb-1 text-sm font-semibold dark:border-slate-700">
            {t('fleet.fuelCards.transfer.from')}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('fleet.odometer.columns.vehicle')}
              required
              missing={required.isMissing('fromVehicle')}
            >
              <VehicleCodeCombobox
                value={fromVehicle}
                onChange={setFromVehicle}
                ariaLabel={t('fleet.fuelCards.transfer.from')}
                placeholder={t('fleet.accidents.vehiclePlaceholder')}
                testId="fuel-transfer-from"
                extra={places}
              />
            </Field>
            <Field
              label={t('fleet.fuelCards.fields.card')}
              required
              missing={required.isMissing('fromCard')}
            >
              <CardPick
                cards={byVehicle(fromVehicle)}
                value={fromCard}
                onChange={setFromCard}
                side="from"
              />
            </Field>
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="border-b border-slate-200 pb-1 text-sm font-semibold dark:border-slate-700">
            {t('fleet.fuelCards.transfer.to')}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('fleet.odometer.columns.vehicle')}
              required
              missing={required.isMissing('toVehicle')}
            >
              <VehicleCodeCombobox
                value={toVehicle}
                onChange={setToVehicle}
                ariaLabel={t('fleet.fuelCards.transfer.to')}
                placeholder={t('fleet.accidents.vehiclePlaceholder')}
                testId="fuel-transfer-to"
                extra={places}
              />
            </Field>
            <Field
              label={t('fleet.fuelCards.fields.card')}
              required
              missing={required.isMissing('toCard')}
              // The same card on both sides: say so rather than «required».
              {...(required.isMissing('toCard') && to !== null
                ? { error: t('fleet.fuelCards.transfer.sameCard') }
                : {})}
            >
              <CardPick
                cards={toChoices}
                value={toCard}
                onChange={setToCard}
                side="to"
                {...(toVehicle !== '' && fromCompany !== null && toChoices.length === 0
                  ? {
                      emptyText: t('fleet.fuelCards.transfer.otherCompany', {
                        company: t(`fleet.fuelCards.company.${fromCompany}`),
                      }),
                    }
                  : {})}
              />
            </Field>
          </div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.fuelCards.transfer.amount')}
            required
            missing={required.isMissing('amount')}
            {...(from !== null && !enough && value > 0
              ? { error: t('fleet.fuelCards.transfer.notEnough', { balance: money(from.balance) }) }
              : {})}
          >
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
        </div>
        {valid && enough && from !== null && to !== null && (
          <div
            data-fuel-transfer-summary="true"
            className="space-y-1 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
          >
            <p>
              {t('fleet.fuelCards.transfer.fromLine', {
                company: t(`fleet.fuelCards.company.${from.company}`),
                code: from.vehicleCode ?? from.label ?? '—',
                before: money(from.balance),
                after: money(from.balance - value),
              })}
            </p>
            <p>
              {t('fleet.fuelCards.transfer.toLine', {
                company: t(`fleet.fuelCards.company.${to.company}`),
                code: to.vehicleCode ?? to.label ?? '—',
                before: money(to.balance),
                after: money(to.balance + value),
              })}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
};
