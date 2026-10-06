// «تحويل رصيد بين كارتين»: pick a car and one of its two cards (from), a car and a card (to), the
// amount — and see what each card was and what it becomes before pressing the button.
//
// «يبقى تحول 1 اختار من اقدر اضيف اكتر من كارت … و + اضافه تحويل لما ادوس عليها يجيب من و الى»:
// one press may carry several transfers, each ONE card giving to one card or more — the same look,
// repeated. A card that gives twice is held to what the transfer before it left.
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useTransferFuelBatch } from '../api/fleet-queries';
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

type Target = { key: number; place: string; card: string; amount: string };
type Transfer = { key: number; place: string; card: string; targets: Target[] };

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
  const next = useRef(0);
  const id = (): number => (next.current += 1);
  const blankTarget = (): Target => ({ key: id(), place: '', card: '', amount: '' });
  const blankTransfer = (): Transfer => ({
    key: id(),
    place: '',
    card: '',
    targets: [blankTarget()],
  });
  const [transfers, setTransfers] = useState<Transfer[]>(() => [blankTransfer()]);
  useEffect(() => {
    if (open) setTransfers([blankTransfer()]);
  }, [open]);

  // A «car» here is a car's id, or the label of cards on no car — they are picked the same way.
  const byPlace = (place: string): FleetFuelCardDto[] =>
    place === '' ? [] : cards.filter((card) => fuelCardPlace(card) === place);
  const cardById = (cardId: string): FleetFuelCardDto | undefined =>
    cards.find((card) => card.id === cardId);
  // «لما ادوس على كارت شركه من تلقائي يحدد نفس الشركه»: a place picked on the «to» side arrives
  // with its card of the giving card's company already ticked.
  const cardOfCompany = (
    place: string,
    company: FleetFuelCardDto['company'] | undefined,
  ): string =>
    company === undefined
      ? ''
      : (byPlace(place).find((card) => card.company === company)?.id ?? '');
  const places = useMemo(() => noCarPlaces(cards), [cards]);

  const editTransfer = (key: number, change: (transfer: Transfer) => Transfer): void =>
    setTransfers((all) =>
      all.map((transfer) => (transfer.key === key ? change(transfer) : transfer)),
    );
  const editTarget = (key: number, targetKey: number, change: Partial<Target>): void =>
    editTransfer(key, (transfer) => ({
      ...transfer,
      targets: transfer.targets.map((target) =>
        target.key === targetKey ? { ...target, ...change } : target,
      ),
    }));
  // «لازم تكون نفس الشركه … وطنيه ل وطنيه»: a giving card of another company re-picks every
  // receiving card to its own company, or drops it.
  const pickFromCard = (key: number, cardId: string): void =>
    editTransfer(key, (transfer) => {
      const company = cardById(cardId)?.company;
      return {
        ...transfer,
        card: cardId,
        targets: transfer.targets.map((target) =>
          cardById(target.card)?.company === company
            ? target
            : { ...target, card: cardOfCompany(target.place, company) },
        ),
      };
    });
  const pickFromPlace = (key: number, place: string): void =>
    editTransfer(key, (transfer) => ({
      ...transfer,
      place,
      // A card already chosen on the «to» side picks the giving car's card of its company.
      card: cardOfCompany(
        place,
        cardById(transfer.targets.find((other) => other.card !== '')?.card ?? '')?.company,
      ),
      // The money goes to another car — a «to» on the same place is emptied.
      targets: transfer.targets.map((target) =>
        target.place === place && place !== '' ? { ...target, place: '', card: '' } : target,
      ),
    }));
  // …and the other way: a «to» card picked first picks the giving card of its company.
  const pickToCard = (key: number, targetKey: number, cardId: string): void =>
    editTransfer(key, (transfer) => ({
      ...transfer,
      card:
        transfer.card !== '' || transfer.place === ''
          ? transfer.card
          : cardOfCompany(transfer.place, cardById(cardId)?.company),
      targets: transfer.targets.map((target) =>
        target.key === targetKey ? { ...target, card: cardId } : target,
      ),
    }));

  // ── What every card holds before and after, step by step ────────────────────────────────────
  const steps = useMemo(() => {
    const running = new Map(cards.map((card) => [card.id, card.balance]));
    return transfers.map((transfer) => {
      const fromBefore = running.get(transfer.card) ?? 0;
      const lines = transfer.targets.map((target) => {
        const value = Number(target.amount);
        const amount = Number.isFinite(value) && value > 0 ? value : 0;
        const giverBefore = running.get(transfer.card) ?? 0;
        const before = running.get(target.card) ?? 0;
        const enough = transfer.card === '' || amount <= giverBefore + 1e-9;
        if (transfer.card !== '' && target.card !== '' && amount > 0) {
          running.set(transfer.card, Math.round((giverBefore - amount) * 100) / 100);
          running.set(target.card, Math.round((before + amount) * 100) / 100);
        }
        return { target, amount, before, giverBefore, enough };
      });
      const taken = lines.reduce((sum, line) => sum + line.amount, 0);
      return { transfer, fromBefore, taken, lines };
    });
  }, [transfers, cards]);

  const money = (n: number): string => formatMoney(n, 'EGP', locale);
  const many = transfers.length > 1;
  const required = useRequiredFields(
    steps.flatMap(({ transfer, lines }, i) => {
      const from = cardById(transfer.card);
      const prefix = many
        ? `${t('fleet.fuelCards.transfer.transferN', { n: String(i + 1) })} · `
        : '';
      return [
        {
          key: `${transfer.key}:place`,
          label: `${prefix}${t('fleet.fuelCards.transfer.from')} · ${t('fleet.odometer.columns.vehicle')}`,
          ok: transfer.place !== '',
        },
        {
          key: `${transfer.key}:card`,
          label: `${prefix}${t('fleet.fuelCards.transfer.from')} · ${t('fleet.fuelCards.fields.card')}`,
          ok: from !== undefined,
        },
        ...lines.flatMap(({ target, amount, enough }) => {
          const to = cardById(target.card);
          return [
            {
              key: `${target.key}:place`,
              label: `${prefix}${t('fleet.fuelCards.transfer.to')} · ${t('fleet.odometer.columns.vehicle')}`,
              ok: target.place !== '' && target.place !== transfer.place,
            },
            {
              key: `${target.key}:card`,
              label: `${prefix}${t('fleet.fuelCards.transfer.to')} · ${t('fleet.fuelCards.fields.card')}`,
              ok:
                to !== undefined &&
                to.id !== from?.id &&
                (from === undefined || to.company === from.company),
            },
            {
              key: `${target.key}:amount`,
              label: `${prefix}${t('fleet.fuelCards.transfer.amount')}`,
              ok: amount > 0 && enough,
            },
          ];
        }),
      ];
    }),
    open,
  );

  const transfer = useTransferFuelBatch();
  const total = steps.reduce((sum, step) => sum + step.taken, 0);
  const submit = async (): Promise<void> => {
    const result = await transfer.mutateAsync({
      transfers: transfers.map((item) => ({
        fromCardId: item.card,
        targets: item.targets.map((target) => ({
          toCardId: target.card,
          amount: Number(target.amount),
        })),
      })),
    });
    toast.success(
      t('fleet.fuelCards.transfer.doneMany', {
        count: String(result.moves),
        amount: money(result.total),
      }),
    );
    onClose();
  };

  if (!open) return null;
  const look = LOOK.add;
  const box = boxTone(look);
  const heading = (text: string, extra?: JSX.Element): JSX.Element => (
    <h3 className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-[#2b3b6b]/60 pb-2 text-[15px] font-bold text-slate-900 dark:text-white">
      <span>{text}</span>
      {extra}
    </h3>
  );
  const addButton = (label: string, onClick: () => void, testId: string): JSX.Element => (
    <button
      type="button"
      data-fuel-transfer-add={testId}
      onClick={onClick}
      className="w-full rounded-xl border border-dashed border-[#6c63ff]/60 py-2 text-sm font-bold text-brand-700 transition hover:bg-[#6c63ff]/10 dark:text-[#a5a0ff]"
    >
      {label}
    </button>
  );
  const removeButton = (label: string, onClick: () => void): JSX.Element => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-1 text-rose-500 transition hover:bg-rose-500/10"
    >
      <Stroke d={CLOSE_PATH} className="h-4 w-4" />
    </button>
  );
  const valueLine = (
    key: string,
    title: string,
    sign: -1 | 1,
    was: number,
    moved: number,
    movedLabel: string,
  ): JSX.Element => (
    <div key={key} data-fuel-transfer-line={key} className="space-y-2">
      <p className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
        <span className={cn('h-2 w-2 rounded-full', sign < 0 ? 'bg-rose-400' : 'bg-emerald-400')} />
        {title}
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          {
            label: t('fleet.fuelCards.transfer.was'),
            amount: was,
            tone: 'text-slate-900 dark:text-white',
          },
          {
            label: movedLabel,
            amount: moved,
            tone: sign < 0 ? 'text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
          },
          {
            label: t('fleet.fuelCards.transfer.becomes'),
            amount: was + sign * moved,
            // More than the card holds: what it would become reads red.
            tone: was + sign * moved < 0 ? 'text-rose-400' : 'text-slate-900 dark:text-white',
          },
        ].map((cell) => (
          <span
            key={cell.label}
            className="rounded-lg border border-slate-200 dark:border-[#2b3b6b]/70 bg-white dark:bg-[#121c3f] px-2 py-2"
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
          {steps.map(({ transfer: item, fromBefore, taken, lines }, i) => {
            const from = cardById(item.card);
            const fromCompany = from?.company;
            return (
              <div
                key={item.key}
                data-fuel-transfer-block={i + 1}
                className={cn(
                  'space-y-6',
                  many && 'rounded-2xl border border-[#6c63ff]/40 p-4 dark:bg-[#0a1233]/40',
                )}
              >
                {many && (
                  <div className="flex items-center justify-between">
                    <b className="text-[15px] text-brand-700 dark:text-[#a5a0ff]">
                      {t('fleet.fuelCards.transfer.transferN', { n: String(i + 1) })}
                    </b>
                    {removeButton(t('fleet.fuelCards.transfer.removeTransfer'), () =>
                      setTransfers((all) => all.filter((other) => other.key !== item.key)),
                    )}
                  </div>
                )}
                <section className="space-y-4">
                  {heading(t('fleet.fuelCards.transfer.from'))}
                  <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
                    <DesignField
                      label={t('fleet.odometer.columns.vehicle')}
                      required
                      missing={required.isMissing(`${item.key}:place`)}
                    >
                      <div className={carBoxClass(false)}>
                        <VehicleCodeCombobox
                          value={item.place}
                          onChange={(place) => pickFromPlace(item.key, place)}
                          ariaLabel={t('fleet.fuelCards.transfer.from')}
                          placeholder={t('fleet.accidents.vehiclePlaceholder')}
                          testId={`fuel-transfer-from-${i + 1}`}
                          extra={places}
                        />
                      </div>
                    </DesignField>
                    <div className="md:col-span-2">
                      <DesignField
                        label={t('fleet.fuelCards.fields.card')}
                        required
                        missing={required.isMissing(`${item.key}:card`)}
                        endAdornment={null}
                      >
                        <CardPick
                          cards={byPlace(item.place)}
                          value={item.card}
                          onChange={(cardId) => pickFromCard(item.key, cardId)}
                          side="from"
                        />
                      </DesignField>
                    </div>
                  </div>
                </section>
                <section className="space-y-4">
                  {heading(t('fleet.fuelCards.transfer.to'))}
                  {lines.map(({ target, giverBefore, enough, amount }, j) => {
                    const choices =
                      target.place === item.place
                        ? []
                        : byPlace(target.place).filter(
                            (card) => fromCompany === undefined || card.company === fromCompany,
                          );
                    return (
                      <div
                        key={target.key}
                        data-fuel-transfer-target={`${i + 1}:${j + 1}`}
                        className={cn(
                          'grid grid-cols-1 items-start gap-5 md:grid-cols-2',
                          j > 0 &&
                            'border-t border-dashed border-slate-200 pt-5 dark:border-[#2b3b6b]/60',
                        )}
                      >
                        <DesignField
                          label={t('fleet.odometer.columns.vehicle')}
                          required
                          missing={required.isMissing(`${target.key}:place`)}
                        >
                          <div className={carBoxClass(false)}>
                            <VehicleCodeCombobox
                              value={target.place}
                              onChange={(place) =>
                                editTarget(item.key, target.key, {
                                  place,
                                  card: cardOfCompany(place, fromCompany),
                                })
                              }
                              ariaLabel={t('fleet.fuelCards.transfer.to')}
                              placeholder={t('fleet.accidents.vehiclePlaceholder')}
                              testId={`fuel-transfer-to-${i + 1}-${j + 1}`}
                              extra={places}
                              exclude={item.place === '' ? [] : [item.place]}
                            />
                          </div>
                        </DesignField>
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <DesignField
                              label={t('fleet.fuelCards.transfer.amount')}
                              required
                              missing={required.isMissing(`${target.key}:amount`)}
                              error={
                                from !== undefined && !enough && amount > 0
                                  ? t('fleet.fuelCards.transfer.notEnough', {
                                      balance: money(giverBefore),
                                    })
                                  : undefined
                              }
                            >
                              <MoneyInput
                                value={target.amount}
                                onChange={(value) =>
                                  editTarget(item.key, target.key, { amount: value })
                                }
                                placeholder="0.00"
                                tone={cn(box, MONO, '!py-3 !pl-10 text-right')}
                              />
                            </DesignField>
                          </div>
                          {item.targets.length > 1 && (
                            <span className="mt-8">
                              {removeButton(t('fleet.fuelCards.transfer.removeTarget'), () =>
                                editTransfer(item.key, (current) => ({
                                  ...current,
                                  targets: current.targets.filter(
                                    (other) => other.key !== target.key,
                                  ),
                                })),
                              )}
                            </span>
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <DesignField
                            label={t('fleet.fuelCards.fields.card')}
                            required
                            missing={required.isMissing(`${target.key}:card`)}
                            endAdornment={null}
                            // The same card on both sides: say so rather than «required».
                            error={
                              required.isMissing(`${target.key}:card`) &&
                              target.card === item.card &&
                              item.card !== ''
                                ? t('fleet.fuelCards.transfer.sameCard')
                                : undefined
                            }
                          >
                            <CardPick
                              cards={choices}
                              value={target.card}
                              onChange={(cardId) => pickToCard(item.key, target.key, cardId)}
                              side="to"
                              {...(target.place !== '' &&
                              target.place !== item.place &&
                              fromCompany !== undefined &&
                              choices.length === 0
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
                    );
                  })}
                  {addButton(
                    t('fleet.fuelCards.transfer.addTarget'),
                    () =>
                      editTransfer(item.key, (current) => ({
                        ...current,
                        targets: [...current.targets, blankTarget()],
                      })),
                    `target-${i + 1}`,
                  )}
                </section>
                {/* «القديم كان كام واتحول منه كام بقى كام والجديد كان كام واتحوله المبلغ بقى كام» —
                    the giving card once, then each card it gives to. */}
                {from !== undefined && taken > 0 && (
                  <div
                    data-fuel-transfer-summary={i + 1}
                    className="space-y-4 rounded-xl border border-slate-200 dark:border-[#2b3b6b] bg-slate-50 dark:bg-[#0a1233] p-4"
                  >
                    {valueLine(
                      `${i + 1}:from`,
                      t('fleet.fuelCards.transfer.fromCard', {
                        company: t(`fleet.fuelCards.company.${from.company}`),
                        code: from.vehicleCode ?? from.label ?? '—',
                      }),
                      -1,
                      fromBefore,
                      taken,
                      t('fleet.fuelCards.transfer.taken'),
                    )}
                    {lines.map(({ target, before, amount }, j) => {
                      const to = cardById(target.card);
                      if (to === undefined || amount <= 0 || to.id === from.id) return null;
                      return valueLine(
                        `${i + 1}:to:${j + 1}`,
                        t('fleet.fuelCards.transfer.toCard', {
                          company: t(`fleet.fuelCards.company.${to.company}`),
                          code: to.vehicleCode ?? to.label ?? '—',
                        }),
                        1,
                        before,
                        amount,
                        t('fleet.fuelCards.transfer.given'),
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {addButton(
            t('fleet.fuelCards.transfer.addTransfer'),
            () => setTransfers((all) => [...all, blankTransfer()]),
            'transfer',
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
              <span>
                {t('fleet.fuelCards.transfer.action')}
                {total > 0 && ` — ${money(total)}`}
              </span>
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
