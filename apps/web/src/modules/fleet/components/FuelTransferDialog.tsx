// «تحويل رصيد بين كارتين»: pick a car and one of its two cards (from), a car and a card (to), the
// amount — and see what each card was and what it becomes before pressing the button.
import { useEffect, useMemo, useState } from 'react';
import { type FleetFuelCardDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { createPortal } from 'react-dom';
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
import { fuelCardPlace, noCarPlaces } from './FuelCardTiles';
import { Spinner } from '../../../shared/ui/Spinner';
import {
  CLOSE_PATH,
  DesignField,
  DesignLogo,
  LOOK,
  MONO,
  SANS,
  Stroke,
  boxTone,
  carBoxClass,
} from './FuelCardDialog';
import { groupCardNumber } from '../lib/fuel-card-number';

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
      <p
        className={cn(
          'text-sm',
          missing ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400',
        )}
      >
        {emptyText ?? t('fleet.fuelCards.transfer.pickCar')}
      </p>
    );
  }
  // «خلى الكروت بالطول»: one card under the other, each a long line — logo and company, number,
  // balance — rather than squares side by side.
  return (
    <div className="space-y-2.5">
      {cards.map((card) => {
        const chosen = value === card.id;
        return (
          <button
            key={card.id}
            type="button"
            data-fuel-transfer-card={`${side}:${card.id}`}
            aria-pressed={chosen}
            onClick={() => onChange(card.id)}
            className={cn(
              'relative flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-start transition-all',
              missing
                ? 'border-red-400 bg-slate-50 dark:bg-[#0a1233]/80'
                : chosen
                  ? 'border-[#6c63ff] [background:linear-gradient(145deg,rgba(108,99,255,0.14),rgba(255,255,255,0.95))] dark:[background:linear-gradient(145deg,rgba(108,99,255,0.28),rgba(15,23,60,0.7))] shadow-[0_0_0_1px_#6c63ff,0_0_22px_-4px_rgba(108,99,255,0.6)]'
                  : 'border-slate-200 dark:border-[#2b3b6b] bg-slate-50 dark:bg-[#0a1233]/80 hover:bg-slate-100 dark:hover:bg-slate-800/60',
            )}
          >
            {chosen && !missing && (
              <span className="absolute -end-1.5 -top-1.5 rounded-full bg-indigo-500 p-0.5 text-white shadow">
                <svg
                  className="h-3.5 w-3.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    clipRule="evenodd"
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  />
                </svg>
              </span>
            )}
            <span className="flex min-w-[9rem] items-center gap-3">
              <DesignLogo company={card.company} editing={false} />
              <span className="whitespace-nowrap text-[15px] font-bold text-slate-900 dark:text-white">
                {t(`fleet.fuelCards.company.${card.company}`)}
              </span>
            </span>
            <span
              className={cn(
                'whitespace-nowrap text-sm font-medium tracking-wider text-slate-800 dark:text-slate-200',
                MONO,
              )}
              dir="ltr"
            >
              {groupCardNumber(card.number)}
            </span>
            <span className="whitespace-nowrap text-[13px] font-medium text-slate-600 dark:text-slate-300">
              {t('fleet.fuelCards.fields.balance')}{' '}
              <b className={cn('text-[15px] text-emerald-600 dark:text-emerald-400', MONO)}>
                {formatMoney(card.balance, 'EGP', locale)}
              </b>
            </span>
          </button>
        );
      })}
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
}): JSX.Element | null => {
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
  // The car the money comes from is never offered as the one it goes to; picking it on the «from»
  // side after it was chosen as «to» empties «to».
  useEffect(() => {
    if (fromVehicle !== '' && toVehicle === fromVehicle) {
      setToVehicle('');
      setToCard('');
    }
  }, [fromVehicle, toVehicle]);

  // A «car» here is a car's id, or the label of cards on no car — they are picked the same way.
  const byVehicle = (vehicleId: string): FleetFuelCardDto[] =>
    vehicleId === '' ? [] : cards.filter((card) => fuelCardPlace(card) === vehicleId);
  // «لما ادوس على كارت شركه من تلقائي يحدد نفس الشركه الى والعكس»: a card picked on one side
  // picks the other car's card of the same company, whichever side is picked first — and a car
  // chosen after the other side's card arrives with its card of that company already ticked.
  const companyOf = (cardId: string): FleetFuelCardDto['company'] | null =>
    cards.find((card) => card.id === cardId)?.company ?? null;
  const cardOfCompany = (vehicleId: string, company: FleetFuelCardDto['company'] | null): string =>
    company === null
      ? ''
      : (byVehicle(vehicleId).find((card) => card.company === company)?.id ?? '');
  const pickFromVehicle = (vehicleId: string): void => {
    setFromVehicle(vehicleId);
    setFromCard(cardOfCompany(vehicleId, companyOf(toCard)));
  };
  const pickToVehicle = (vehicleId: string): void => {
    setToVehicle(vehicleId);
    setToCard(cardOfCompany(vehicleId, companyOf(fromCard)));
  };
  const pickFromCard = (cardId: string): void => {
    setFromCard(cardId);
    const match = cardOfCompany(toVehicle, companyOf(cardId));
    if (toVehicle !== '') setToCard(match);
  };
  const pickToCard = (cardId: string): void => {
    setToCard(cardId);
    const match = cardOfCompany(fromVehicle, companyOf(cardId));
    if (fromVehicle !== '' && match !== '') setFromCard(match);
  };
  const places = useMemo(() => noCarPlaces(cards), [cards]);
  // «لازم تكون نفس الشركه … وطنيه ل وطنيه ومينفعش وطنيه ل شيل اوت والعكس صحيح»: once the first
  // card is chosen, the second is offered from its company only.
  const fromCompany = cards.find((card) => card.id === fromCard)?.company ?? null;
  // «مينفعش نفس العربيه من تكون الى هى هى نفس العربيه»: the money goes to another car — the «to»
  // box does not offer the «from» car at all; this guard only holds the line in between.
  const sameCar = fromVehicle !== '' && toVehicle === fromVehicle;
  const toChoices = sameCar
    ? []
    : byVehicle(toVehicle).filter((card) => fromCompany === null || card.company === fromCompany);
  // A first card of the other company makes a chosen second card unreachable — it is dropped.
  useEffect(() => {
    if (fromCompany === null) return;
    const chosen = cards.find((card) => card.id === toCard);
    if (chosen !== undefined && chosen.company !== fromCompany) setToCard('');
  }, [fromCompany, toCard, cards]);
  const from = useMemo(() => cards.find((card) => card.id === fromCard) ?? null, [cards, fromCard]);
  const to = useMemo(() => cards.find((card) => card.id === toCard) ?? null, [cards, toCard]);
  const value = Number(amount);
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
        ok: toVehicle !== '' && !sameCar,
      },
      {
        key: 'toCard',
        label: `${t('fleet.fuelCards.transfer.to')} · ${t('fleet.fuelCards.fields.card')}`,
        ok:
          !sameCar &&
          to !== null &&
          to.id !== from?.id &&
          (from === null || to.company === from.company),
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
    toast.success(
      t('fleet.fuelCards.transfer.doneDetail', {
        amount: money(value),
        from: from.vehicleCode ?? from.label ?? '—',
        to: to.vehicleCode ?? to.label ?? '—',
      }),
    );
    onClose();
  };

  if (!open) return null;
  const look = LOOK.add;
  const box = boxTone(look);
  const heading = (text: string): JSX.Element => (
    <h3 className="border-b border-slate-200 dark:border-[#2b3b6b]/60 pb-2 text-[15px] font-bold text-slate-900 dark:text-white">
      {text}
    </h3>
  );

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-3 sm:p-4">
      <div
        className="fixed inset-0 animate-fade-in bg-slate-900/40 dark:bg-[#03060c]/80 backdrop-blur-md"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('fleet.fuelCards.transfer.title')}
        data-fuel-transfer-form="true"
        className={cn(
          SANS,
          'relative my-auto w-full animate-pop-in overflow-hidden rounded-2xl border text-slate-900 dark:text-slate-100 antialiased',
          look.panel,
        )}
      >
        <header className={cn('flex items-center justify-between border-b px-6', look.header)}>
          <div className="flex items-center gap-3">
            <div className={cn('flex items-center justify-center rounded-xl border', look.icon)}>
              <Stroke
                d={['M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4']}
                className="h-5 w-5"
              />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-wide text-slate-900 dark:text-white">
                {t('fleet.fuelCards.transfer.title')}
              </h2>
              <p
                className={cn(
                  'text-[13px] font-medium text-slate-600 dark:text-slate-300',
                  look.subtitle,
                )}
              >
                {t('fleet.fuelCards.transfer.hint')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className={cn(
              'flex items-center text-slate-500 dark:text-slate-400 transition-all hover:text-slate-900 dark:hover:text-white focus:outline-none',
              look.close,
            )}
          >
            <Stroke d={CLOSE_PATH} className="h-5 w-5" />
          </button>
        </header>

        <div className={cn('max-h-[calc(100vh-9rem)] space-y-6 overflow-y-auto', look.body)}>
          <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
          <section className="space-y-4">
            {heading(t('fleet.fuelCards.transfer.from'))}
            <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
              <DesignField
                label={t('fleet.odometer.columns.vehicle')}
                required
                missing={required.isMissing('fromVehicle')}
              >
                <div className={carBoxClass(false)}>
                  <VehicleCodeCombobox
                    value={fromVehicle}
                    onChange={pickFromVehicle}
                    ariaLabel={t('fleet.fuelCards.transfer.from')}
                    placeholder={t('fleet.accidents.vehiclePlaceholder')}
                    testId="fuel-transfer-from"
                    extra={places}
                  />
                </div>
              </DesignField>
              <div className="md:col-span-2">
                <DesignField
                  label={t('fleet.fuelCards.fields.card')}
                  required
                  missing={required.isMissing('fromCard')}
                  endAdornment={null}
                >
                  <CardPick
                    cards={byVehicle(fromVehicle)}
                    value={fromCard}
                    onChange={pickFromCard}
                    side="from"
                  />
                </DesignField>
              </div>
            </div>
          </section>
          <section className="space-y-4">
            {heading(t('fleet.fuelCards.transfer.to'))}
            <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
              <DesignField
                label={t('fleet.odometer.columns.vehicle')}
                required
                missing={required.isMissing('toVehicle')}
              >
                <div className={carBoxClass(false)}>
                  <VehicleCodeCombobox
                    value={toVehicle}
                    onChange={pickToVehicle}
                    ariaLabel={t('fleet.fuelCards.transfer.to')}
                    placeholder={t('fleet.accidents.vehiclePlaceholder')}
                    testId="fuel-transfer-to"
                    extra={places}
                    exclude={fromVehicle === '' ? [] : [fromVehicle]}
                  />
                </div>
              </DesignField>
              <div className="md:col-span-2">
                <DesignField
                  label={t('fleet.fuelCards.fields.card')}
                  required
                  missing={required.isMissing('toCard')}
                  endAdornment={null}
                  // The same card on both sides: say so rather than «required».
                  error={
                    required.isMissing('toCard') && to !== null
                      ? t('fleet.fuelCards.transfer.sameCard')
                      : undefined
                  }
                >
                  <CardPick
                    cards={toChoices}
                    value={toCard}
                    onChange={pickToCard}
                    side="to"
                    {...(!sameCar &&
                    toVehicle !== '' &&
                    fromCompany !== null &&
                    toChoices.length === 0
                      ? {
                          emptyText: t('fleet.fuelCards.transfer.otherCompany', {
                            company: t(`fleet.fuelCards.company.${fromCompany}`),
                          }),
                        }
                      : {})}
                  />
                </DesignField>
              </div>
            </div>
          </section>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <DesignField
              label={t('fleet.fuelCards.transfer.amount')}
              required
              missing={required.isMissing('amount')}
              error={
                from !== null && !enough && value > 0
                  ? t('fleet.fuelCards.transfer.notEnough', { balance: money(from.balance) })
                  : undefined
              }
            >
              <MoneyInput
                value={amount}
                onChange={setAmount}
                placeholder="0.00"
                tone={cn(box, MONO, '!py-3 !pl-10 text-right')}
              />
            </DesignField>
          </div>
          {/* «لما اكتب المبلغ يجيب الكارت من قبل الخصم كام وبعد الخصم كام والكارت الى كام وبعد
              الاضافه كام» — as soon as there is an amount, each card already chosen shows its line. */}
          {Number.isFinite(value) && value > 0 && (from !== null || (to !== null && !sameCar)) && (
            <div
              data-fuel-transfer-summary="true"
              className="space-y-4 rounded-xl border border-slate-200 dark:border-[#2b3b6b] bg-slate-50 dark:bg-[#0a1233] p-4"
            >
              {/* «القديم كان كام واتحول منه كام بقى كام والجديد كان كام واتحوله المبلغ بقى كام» —
                  each card on its own line: what it held, what moves, what it will hold. */}
              {(
                [
                  ...(from === null ? [] : [{ side: 'from', card: from, sign: -1 }]),
                  ...(to === null || sameCar ? [] : [{ side: 'to', card: to, sign: 1 }]),
                ] as const
              ).map(({ side, card, sign }) => (
                <div key={side} data-fuel-transfer-line={side} className="space-y-2">
                  <p className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        sign < 0 ? 'bg-rose-400' : 'bg-emerald-400',
                      )}
                    />
                    {t(
                      side === 'from'
                        ? 'fleet.fuelCards.transfer.fromCard'
                        : 'fleet.fuelCards.transfer.toCard',
                      {
                        company: t(`fleet.fuelCards.company.${card.company}`),
                        code: card.vehicleCode ?? card.label ?? '—',
                      },
                    )}
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      {
                        label: t('fleet.fuelCards.transfer.was'),
                        amount: card.balance,
                        tone: 'text-slate-900 dark:text-white',
                      },
                      {
                        label: t(
                          side === 'from'
                            ? 'fleet.fuelCards.transfer.taken'
                            : 'fleet.fuelCards.transfer.given',
                        ),
                        amount: value,
                        tone: sign < 0 ? 'text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
                      },
                      {
                        label: t('fleet.fuelCards.transfer.becomes'),
                        amount: card.balance + sign * value,
                        // More than the first card holds: what it would become reads red.
                        tone:
                          card.balance + sign * value < 0
                            ? 'text-rose-400'
                            : 'text-slate-900 dark:text-white',
                      },
                    ].map((cell) => (
                      <span
                        key={cell.label}
                        className="rounded-lg border border-slate-200 dark:border-[#2b3b6b]/70 bg-[#121c3f] px-2 py-2"
                      >
                        <span className="block text-[12px] font-medium text-slate-600 dark:text-slate-300">
                          {cell.label}
                        </span>
                        <b className={cn('text-[15px]', MONO, cell.tone)} dir="ltr">
                          {money(cell.amount)}
                        </b>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={cn('mt-6 flex items-center justify-start gap-3 border-t', look.footer)}>
            <button
              type="button"
              data-fuel-transfer-submit="true"
              aria-busy={transfer.isPending}
              onClick={required.guard(submit)}
              className={cn(
                'flex items-center gap-2 rounded-xl py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98]',
                look.save,
              )}
            >
              {transfer.isPending && <Spinner className="h-4 w-4" />}
              <span>{t('fleet.fuelCards.transfer.action')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'rounded-xl border bg-white dark:bg-[#1a2550] py-2.5 text-[15px] font-bold text-slate-900 dark:text-slate-100 transition-all hover:bg-slate-200 dark:hover:bg-slate-700/80 hover:text-slate-900 dark:hover:text-white active:scale-[0.98]',
                look.cancel,
              )}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
