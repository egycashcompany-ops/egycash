// «تحويل رصيد بين كارتين»: pick a car and one of its two cards (from), a car and a card (to), the
// amount — and see what each card was and what it becomes before pressing the button.
import { useEffect, useMemo, useState } from 'react';
import { type FleetFuelCardDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatMoney } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useTransferFuelBalance } from '../api/fleet-queries';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { FuelCompanyLogo } from './FuelCardTiles';

const CardPick = ({
  cards,
  value,
  onChange,
  side,
}: {
  cards: readonly FleetFuelCardDto[];
  value: string;
  onChange: (id: string) => void;
  side: 'from' | 'to';
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (cards.length === 0) {
    return <p className="text-sm text-slate-400">{t('fleet.fuelCards.transfer.pickCar')}</p>;
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

  const byVehicle = (vehicleId: string): FleetFuelCardDto[] =>
    vehicleId === '' ? [] : cards.filter((card) => card.vehicleId === vehicleId);
  const from = useMemo(() => cards.find((card) => card.id === fromCard) ?? null, [cards, fromCard]);
  const to = useMemo(() => cards.find((card) => card.id === toCard) ?? null, [cards, toCard]);
  const value = Number(amount);
  const valid =
    from !== null && to !== null && from.id !== to.id && Number.isFinite(value) && value > 0;
  const enough = from !== null && value <= from.balance;
  const money = (n: number): string => formatMoney(n, 'EGP', locale);

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
          <Button
            loading={transfer.isPending}
            disabled={!valid || !enough}
            onClick={() => void submit()}
          >
            {t('fleet.fuelCards.transfer.action')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="border-b border-slate-200 pb-1 text-sm font-semibold dark:border-slate-700">
            {t('fleet.fuelCards.transfer.from')}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fleet.odometer.columns.vehicle')} required>
              <VehicleCodeCombobox
                value={fromVehicle}
                onChange={setFromVehicle}
                wholeRegistry
                ariaLabel={t('fleet.fuelCards.transfer.from')}
                placeholder={t('fleet.accidents.vehiclePlaceholder')}
                testId="fuel-transfer-from"
              />
            </Field>
            <Field label={t('fleet.fuelCards.fields.card')} required>
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
            <Field label={t('fleet.odometer.columns.vehicle')} required>
              <VehicleCodeCombobox
                value={toVehicle}
                onChange={setToVehicle}
                wholeRegistry
                ariaLabel={t('fleet.fuelCards.transfer.to')}
                placeholder={t('fleet.accidents.vehiclePlaceholder')}
                testId="fuel-transfer-to"
              />
            </Field>
            <Field label={t('fleet.fuelCards.fields.card')} required>
              <CardPick
                cards={byVehicle(toVehicle)}
                value={toCard}
                onChange={setToCard}
                side="to"
              />
            </Field>
          </div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.fuelCards.transfer.amount')}
            required
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
                code: from.vehicleCode ?? '—',
                before: money(from.balance),
                after: money(from.balance - value),
              })}
            </p>
            <p>
              {t('fleet.fuelCards.transfer.toLine', {
                company: t(`fleet.fuelCards.company.${to.company}`),
                code: to.vehicleCode ?? '—',
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
