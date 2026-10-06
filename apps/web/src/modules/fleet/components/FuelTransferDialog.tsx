// «تحويل رصيد بين كارتين»: pick a car and one of its two cards (from), a car and a card (to), the
// amount — and see what each card was and what it becomes before pressing the button.
//
// «يبقى تحول 1 اختار من اقدر اضيف اكتر من كارت … و + اضافه تحويل لما ادوس عليها يجيب من و الى»:
// one press may carry several transfers, each ONE card giving to one card or more. A card that
// gives twice is held to what the transfer before it left.
//
// «زى شحن الكروت … اختار عربية وممكن اعمل مالتى سيلكت لاكتر من عربية … فيبقى عندى بلوكين فوق
// بعض»: each transfer is two blocks, one over the other — «من» and «إلى» — and each picks its cars
// the way the charging screen's filter does, several at once, then the cards among them.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { VehicleCodeFilter } from './VehicleCodeFilter';
import { FILTER_ICON, FilterWithIcon } from './FilterWithIcon';
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

/** Where a card sits, as the reader names it: its car's code, or its label on no car. */
const placeOf = (card: FleetFuelCardDto): string => card.vehicleCode ?? card.label ?? '—';

/** The numbered cars first, in order; a code that is no number after them. */
const byCode = (a: string, b: string): number =>
  (/^\d/u.test(a) ? 0 : 1) - (/^\d/u.test(b) ? 0 : 1) ||
  a.localeCompare(b, 'en', { numeric: true });

/**
 * The car box of a block — the charging screen's own multi-pick, on the dialog's surface: several
 * cars at once, typed or picked, every place that holds a card on offer.
 */
const CAR_PICK = cn(
  '[&_button[aria-haspopup]]:!min-h-[3rem] [&_button[aria-haspopup]]:!rounded-xl [&_button[aria-haspopup]]:!border-slate-200 dark:[&_button[aria-haspopup]]:!border-[#2b3b6b] [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#0a1233] [&_button[aria-haspopup]]:!text-[15px] [&_button[aria-haspopup]]:!text-slate-900 dark:[&_button[aria-haspopup]]:!text-white',
  '[&_[role=listbox]]:!rounded-xl [&_[role=listbox]]:!border-slate-200 dark:[&_[role=listbox]]:!border-[#2b3b6b] [&_[role=listbox]]:!bg-white dark:[&_[role=listbox]]:!bg-[#131d35]',
);

/** A receiving card: ticked or not, and — ticked — the amount it is given. */
const CardTick = ({
  card,
  ticked,
  missing,
  onToggle,
  amountBox,
}: {
  card: FleetFuelCardDto;
  ticked: boolean;
  missing: boolean;
  onToggle: () => void;
  amountBox: ReactNode;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="space-y-2">
      <button
        type="button"
        data-fuel-transfer-tick={card.id}
        aria-pressed={ticked}
        onClick={onToggle}
        className={cn(
          'relative flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-start transition-all',
          missing
            ? 'border-red-400 bg-slate-50 dark:bg-[#0a1233]/80'
            : ticked
              ? 'border-[#6c63ff] [background:linear-gradient(145deg,rgba(108,99,255,0.14),rgba(255,255,255,0.95))] dark:[background:linear-gradient(145deg,rgba(108,99,255,0.28),rgba(15,23,60,0.7))] shadow-[0_0_0_1px_#6c63ff]'
              : 'border-slate-200 dark:border-[#2b3b6b] bg-slate-50 dark:bg-[#0a1233]/80 hover:bg-slate-100 dark:hover:bg-slate-800/60',
        )}
      >
        <span className="flex min-w-[8rem] items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[12px] font-black',
              ticked
                ? 'border-[#6c63ff] bg-[#6c63ff] text-white'
                : 'border-slate-300 dark:border-slate-600',
            )}
          >
            {ticked ? '✓' : ''}
          </span>
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
      {/* The amount under its card, once ticked — a whole line, so the card keeps its width. */}
      {ticked && <div className="ms-8 max-w-xs">{amountBox}</div>}
    </div>
  );
};

type Transfer = {
  key: number;
  /** The places picked in «من» — car codes, or labels of cards on no car. */
  fromPlaces: string[];
  /** The giving card. */
  card: string;
  /** The places picked in «إلى». */
  toPlaces: string[];
  /** The receiving cards ticked, in the order they were ticked. */
  picked: string[];
  amounts: Record<string, string>;
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
  const next = useRef(0);
  const blankTransfer = (): Transfer => ({
    key: (next.current += 1),
    fromPlaces: [],
    card: '',
    toPlaces: [],
    picked: [],
    amounts: {},
  });
  const [transfers, setTransfers] = useState<Transfer[]>(() => [blankTransfer()]);
  useEffect(() => {
    if (open) setTransfers([blankTransfer()]);
  }, [open]);

  const cardById = (cardId: string): FleetFuelCardDto | undefined =>
    cards.find((card) => card.id === cardId);
  const cardsAt = (places: readonly string[]): FleetFuelCardDto[] =>
    cards.filter((card) => places.includes(placeOf(card)));
  // Every place that holds a card — what both boxes offer, the numbered cars first.
  const placeOptions = useMemo(
    () =>
      [...new Set(cards.map(placeOf))]
        .sort(byCode)
        .map((place) => ({ value: place, label: place })),
    [cards],
  );

  const edit = (key: number, change: (transfer: Transfer) => Transfer): void =>
    setTransfers((all) => all.map((item) => (item.key === key ? change(item) : item)));
  // «وطنيه ل وطنيه ومينفعش وطنيه ل شيل اوت»: only the giving card's company receives, and never
  // the giving card itself — a tick that no longer answers is let go.
  const tidy = (transfer: Transfer): Transfer => {
    const company = cardById(transfer.card)?.company;
    const picked = transfer.picked.filter((id) => {
      const card = cardById(id);
      return (
        card !== undefined &&
        id !== transfer.card &&
        transfer.toPlaces.includes(placeOf(card)) &&
        (company === undefined || card.company === company)
      );
    });
    return { ...transfer, picked };
  };
  const pickFromPlaces = (key: number, places: string[]): void =>
    edit(key, (transfer) => {
      const card = cardById(transfer.card);
      const keep = card !== undefined && places.includes(placeOf(card));
      // One car with one card of the company already being given to: that card, at once.
      const candidates = cardsAt(places).filter(
        (one) =>
          transfer.picked.length === 0 ||
          one.company === cardById(transfer.picked[0] ?? '')?.company,
      );
      const auto = !keep && candidates.length === 1 ? (candidates[0]?.id ?? '') : '';
      return tidy({ ...transfer, fromPlaces: places, card: keep ? transfer.card : auto });
    });
  const pickFromCard = (key: number, cardId: string): void =>
    edit(key, (transfer) => {
      const company = cardById(cardId)?.company;
      // «لما ادوس على كارت شركه من تلقائي يحدد نفس الشركه»: every «إلى» car ticks its card of
      // the giving card's company.
      const auto = cardsAt(transfer.toPlaces)
        .filter((card) => card.company === company && card.id !== cardId)
        .map((card) => card.id);
      const picked = [...new Set([...transfer.picked, ...auto])];
      return tidy({ ...transfer, card: cardId, picked });
    });
  const pickToPlaces = (key: number, places: string[]): void =>
    edit(key, (transfer) => {
      const company = cardById(transfer.card)?.company;
      const added = places.filter((place) => !transfer.toPlaces.includes(place));
      // A car added to «إلى» arrives with its card of the giving company ticked.
      const auto =
        company === undefined
          ? []
          : cardsAt(added)
              .filter((card) => card.company === company && card.id !== transfer.card)
              .map((card) => card.id);
      return tidy({
        ...transfer,
        toPlaces: places,
        picked: [...new Set([...transfer.picked, ...auto])],
      });
    });
  const toggleTarget = (key: number, cardId: string): void =>
    edit(key, (transfer) => {
      const on = transfer.picked.includes(cardId);
      const picked = on
        ? transfer.picked.filter((id) => id !== cardId)
        : [...transfer.picked, cardId];
      // A card ticked first picks the giving card of its company, when «من» has just one.
      let card = transfer.card;
      if (!on && card === '') {
        const company = cardById(cardId)?.company;
        const candidates = cardsAt(transfer.fromPlaces).filter(
          (one) => one.company === company && one.id !== cardId,
        );
        if (candidates.length === 1) card = candidates[0]?.id ?? '';
      }
      return tidy({ ...transfer, card, picked });
    });

  // ── What every card holds before and after, step by step ────────────────────────────────────
  const steps = useMemo(() => {
    const running = new Map(cards.map((card) => [card.id, card.balance]));
    return transfers.map((transfer) => {
      const fromBefore = running.get(transfer.card) ?? 0;
      const lines = transfer.picked.map((cardId) => {
        const value = Number(transfer.amounts[cardId] ?? '');
        const amount = Number.isFinite(value) && value > 0 ? value : 0;
        const giverBefore = running.get(transfer.card) ?? 0;
        const before = running.get(cardId) ?? 0;
        const enough = transfer.card === '' || amount <= giverBefore + 1e-9;
        if (transfer.card !== '' && amount > 0) {
          running.set(transfer.card, Math.round((giverBefore - amount) * 100) / 100);
          running.set(cardId, Math.round((before + amount) * 100) / 100);
        }
        return { cardId, amount, before, giverBefore, enough };
      });
      const taken = lines.reduce((sum, line) => sum + line.amount, 0);
      return { transfer, fromBefore, taken, lines };
    });
  }, [transfers, cards]);

  const money = (n: number): string => formatMoney(n, 'EGP', locale);
  const many = transfers.length > 1;
  const required = useRequiredFields(
    steps.flatMap(({ transfer, lines }, i) => {
      const prefix = many
        ? `${t('fleet.fuelCards.transfer.transferN', { n: String(i + 1) })} · `
        : '';
      const from = `${prefix}${t('fleet.fuelCards.transfer.from')}`;
      const to = `${prefix}${t('fleet.fuelCards.transfer.to')}`;
      return [
        {
          key: `${transfer.key}:fromPlaces`,
          label: `${from} · ${t('fleet.odometer.columns.vehicle')}`,
          ok: transfer.fromPlaces.length > 0,
        },
        {
          key: `${transfer.key}:card`,
          label: `${from} · ${t('fleet.fuelCards.fields.card')}`,
          ok: cardById(transfer.card) !== undefined,
        },
        {
          key: `${transfer.key}:toPlaces`,
          label: `${to} · ${t('fleet.odometer.columns.vehicle')}`,
          ok: transfer.toPlaces.length > 0,
        },
        {
          key: `${transfer.key}:picked`,
          label: `${to} · ${t('fleet.fuelCards.fields.card')}`,
          ok: transfer.picked.length > 0,
        },
        ...lines.map(({ cardId, amount, enough }) => ({
          key: `${transfer.key}:${cardId}:amount`,
          label: `${to} · ${placeOf(cardById(cardId) ?? ({} as FleetFuelCardDto))} · ${t('fleet.fuelCards.transfer.amount')}`,
          ok: amount > 0 && enough,
        })),
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
        targets: item.picked.map((cardId) => ({
          toCardId: cardId,
          amount: Number(item.amounts[cardId] ?? ''),
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
  const heading = (text: string): JSX.Element => (
    <h3 className="border-b border-slate-200 dark:border-[#2b3b6b]/60 pb-2 text-[15px] font-bold text-slate-900 dark:text-white">
      {text}
    </h3>
  );
  /** A place's name over its cards — several cars picked at once read car by car. */
  const placeHeading = (place: string): JSX.Element => (
    <p className="text-[13px] font-bold text-slate-600 dark:text-slate-300">
      {t('fleet.odometer.columns.vehicle')}:{' '}
      <span className={cn('text-slate-900 dark:text-white', /^\d+$/u.test(place) && MONO)}>
        {place}
      </span>
    </p>
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
            const company = from?.company;
            const fromCards = cardsAt(item.fromPlaces);
            const fromGroups = item.fromPlaces.map((place) => ({
              place,
              cards: fromCards.filter((card) => placeOf(card) === place),
            }));
            // «إلى» offers the giving card's company only, and never the giving card itself.
            const toGroups = item.toPlaces.map((place) => {
              const here = cardsAt([place]);
              return {
                place,
                cards: here.filter(
                  (card) =>
                    card.id !== item.card && (company === undefined || card.company === company),
                ),
                otherCompanyOnly: here.length > 0 && company !== undefined,
              };
            });
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
                    <button
                      type="button"
                      aria-label={t('fleet.fuelCards.transfer.removeTransfer')}
                      title={t('fleet.fuelCards.transfer.removeTransfer')}
                      onClick={() =>
                        setTransfers((all) => all.filter((other) => other.key !== item.key))
                      }
                      className="rounded-md p-1 text-rose-500 transition hover:bg-rose-500/10"
                    >
                      <Stroke d={CLOSE_PATH} className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {/* ── «من» ── */}
                <section
                  data-fuel-transfer-side={`${i + 1}:from`}
                  className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-[#2b3b6b]/70"
                >
                  {heading(t('fleet.fuelCards.transfer.from'))}
                  <DesignField
                    label={t('fleet.odometer.columns.vehicle')}
                    required
                    missing={required.isMissing(`${item.key}:fromPlaces`)}
                  >
                    <FilterWithIcon
                      icon={FILTER_ICON.car}
                      tone="text-emerald-600 dark:text-emerald-400"
                      className={CAR_PICK}
                    >
                      <VehicleCodeFilter
                        fullWidth
                        placeholder={t('fleet.fuelCards.board.searchCar')}
                        options={placeOptions}
                        value={item.fromPlaces}
                        onChange={(places) => pickFromPlaces(item.key, places)}
                      />
                    </FilterWithIcon>
                  </DesignField>
                  {fromGroups.length > 0 && (
                    <DesignField
                      label={t('fleet.fuelCards.fields.card')}
                      required
                      missing={required.isMissing(`${item.key}:card`)}
                      endAdornment={null}
                    >
                      <div className="space-y-3">
                        {fromGroups.map((group) => (
                          <div key={group.place} className="space-y-2">
                            {fromGroups.length > 1 && placeHeading(group.place)}
                            <CardPick
                              cards={group.cards}
                              value={item.card}
                              onChange={(cardId) => pickFromCard(item.key, cardId)}
                              side="from"
                            />
                          </div>
                        ))}
                      </div>
                    </DesignField>
                  )}
                </section>
                {/* ── «إلى» ── */}
                <section
                  data-fuel-transfer-side={`${i + 1}:to`}
                  className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-[#2b3b6b]/70"
                >
                  {heading(t('fleet.fuelCards.transfer.to'))}
                  <DesignField
                    label={t('fleet.odometer.columns.vehicle')}
                    required
                    missing={required.isMissing(`${item.key}:toPlaces`)}
                  >
                    <FilterWithIcon
                      icon={FILTER_ICON.car}
                      tone="text-emerald-600 dark:text-emerald-400"
                      className={CAR_PICK}
                    >
                      <VehicleCodeFilter
                        fullWidth
                        placeholder={t('fleet.fuelCards.board.searchCar')}
                        options={placeOptions.filter(
                          (option) => from === undefined || option.value !== placeOf(from),
                        )}
                        value={item.toPlaces}
                        onChange={(places) => pickToPlaces(item.key, places)}
                      />
                    </FilterWithIcon>
                  </DesignField>
                  {toGroups.length > 0 && (
                    <DesignField
                      label={t('fleet.fuelCards.fields.card')}
                      required
                      missing={required.isMissing(`${item.key}:picked`)}
                      endAdornment={null}
                    >
                      <div className="space-y-3">
                        {toGroups.map((group) => (
                          <div key={group.place} className="space-y-2">
                            {placeHeading(group.place)}
                            {group.cards.length === 0 ? (
                              <p className="text-sm text-slate-500 dark:text-slate-400">
                                {group.otherCompanyOnly && company !== undefined
                                  ? t('fleet.fuelCards.transfer.otherCompany', {
                                      company: t(`fleet.fuelCards.company.${company}`),
                                    })
                                  : t('fleet.fuelCards.transfer.pickCar')}
                              </p>
                            ) : (
                              group.cards.map((card) => {
                                const line = lines.find((one) => one.cardId === card.id);
                                const amountKey = `${item.key}:${card.id}:amount`;
                                return (
                                  <CardTick
                                    key={card.id}
                                    card={card}
                                    ticked={item.picked.includes(card.id)}
                                    missing={required.isMissing(`${item.key}:picked`)}
                                    onToggle={() => toggleTarget(item.key, card.id)}
                                    amountBox={
                                      <DesignField
                                        label={t('fleet.fuelCards.transfer.amount')}
                                        required
                                        missing={required.isMissing(amountKey)}
                                        error={
                                          from !== undefined &&
                                          line !== undefined &&
                                          !line.enough &&
                                          line.amount > 0
                                            ? t('fleet.fuelCards.transfer.notEnough', {
                                                balance: money(line.giverBefore),
                                              })
                                            : undefined
                                        }
                                      >
                                        <MoneyInput
                                          value={item.amounts[card.id] ?? ''}
                                          onChange={(value) =>
                                            edit(item.key, (current) => ({
                                              ...current,
                                              amounts: { ...current.amounts, [card.id]: value },
                                            }))
                                          }
                                          placeholder="0.00"
                                          tone={cn(box, MONO, '!py-3 !pl-10 text-right')}
                                        />
                                      </DesignField>
                                    }
                                  />
                                );
                              })
                            )}
                          </div>
                        ))}
                      </div>
                    </DesignField>
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
                        code: placeOf(from),
                      }),
                      -1,
                      fromBefore,
                      taken,
                      t('fleet.fuelCards.transfer.taken'),
                    )}
                    {lines.map(({ cardId, before, amount }, j) => {
                      const to = cardById(cardId);
                      if (to === undefined || amount <= 0) return null;
                      return valueLine(
                        `${i + 1}:to:${j + 1}`,
                        t('fleet.fuelCards.transfer.toCard', {
                          company: t(`fleet.fuelCards.company.${to.company}`),
                          code: placeOf(to),
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
          <button
            type="button"
            data-fuel-transfer-add="transfer"
            onClick={() => setTransfers((all) => [...all, blankTransfer()])}
            className="w-full rounded-xl border border-dashed border-[#6c63ff]/60 py-2 text-sm font-bold text-brand-700 transition hover:bg-[#6c63ff]/10 dark:text-[#a5a0ff]"
          >
            {t('fleet.fuelCards.transfer.addTransfer')}
          </button>

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
