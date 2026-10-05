// The fuel-cards screen built from the owner's own design code, class for class: «بطاقات الوقود غير
// شكلها ل دا بالظبط». The figures across the top, then one block per car — its code and how many of
// its two slots are filled down the side, a line per card (logo and name, the number with its copy
// button, the expiry with its state, the PIN behind its eye, the photo, edit and delete), a dashed
// line for a free slot, and a car with no card at all says so and offers the stock or a new card.
// The cards on no car — the stock («العهدة / المخزن») — close the screen in a section of their own.
//
// The design's colours are this screen's own, written here rather than taken from the theme: the
// owner sent them and asked for them as they are.
import { useState, type ReactNode } from 'react';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/cairo/900.css';
import { type FleetFuelCardCompany, type FleetFuelCardDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { toast } from '../../../shared/ui/toast/toast-store';
import { revealFuelCardPassword } from '../api/fleet-api';
import { FUEL_CARD_LOGO } from './FuelCardTiles';
import { groupCardNumber } from '../lib/fuel-card-number';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ExpiryState = 'valid' | 'soon' | 'expired' | 'unknown';

/** Where a card's expiry stands today, against the setting's warning days. */
export const expiryState = (
  expiresAt: string | null,
  warnDays: number,
  now = Date.now(),
): ExpiryState => {
  if (expiresAt === null) return 'unknown';
  const left = new Date(expiresAt).getTime() - now;
  if (left < 0) return 'expired';
  return left <= warnDays * DAY_MS ? 'soon' : 'valid';
};

/** The design's type: Cairo for the words. */
export const BOARD_FONT = "[font-family:'Cairo',sans-serif]";
/** The design's `.num-mono`: the system monospace with tabular figures. */
export const NUM =
  '[font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace] [font-feature-settings:"tnum"] tabular-nums';

/** «2027/09/30» — the design writes a date year first, with slashes. */
export const ymd = (iso: string | null): string =>
  iso === null ? '—' : iso.slice(0, 10).replace(/-/gu, '/');

/** Chill Out's red mark, square, for the small badges. Wataniya keeps its logo. */
const CHILLOUT_SQUARE = '/fleet-fuel-cards/chillout-red-square.png';

/** The design's stroke icons, drawn as the design draws them. */
const Svg = ({
  d,
  className,
  width = 2,
}: {
  d: readonly string[];
  className: string;
  width?: number;
}): JSX.Element => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    {d.map((path) => (
      <path key={path} d={path} strokeLinecap="round" strokeLinejoin="round" strokeWidth={width} />
    ))}
  </svg>
);
export const PATH = {
  truck: [
    'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z',
    'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0',
  ],
  card: ['M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'],
  warn: [
    'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  ],
  trend: ['M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'],
  calendar: [
    'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  ],
  excel: [
    'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  ],
  pdf: [
    'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
    'M9 13h6m-6 4h4',
  ],
  plus: ['M12 4v16m8-8H4'],
  copy: [
    'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
  ],
  eye: [
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  ],
  eyeOff: [
    'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21',
  ],
  image: [
    'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  ],
  edit: [
    'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  ],
  trash: [
    'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  ],
  lock: [
    'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  ],
  link: [
    'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  ],
  box: [
    'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  ],
} as const;
export const BoardIcon = Svg;

// ── The figures across the top ─────────────────────────────────────────────────────────────────

const KPI_TONE = {
  blue: { glow: 'bg-blue-500/5 group-hover:bg-blue-500/10', icon: 'bg-blue-500/10 text-blue-400' },
  emerald: {
    glow: 'bg-emerald-500/5 group-hover:bg-emerald-500/10',
    icon: 'bg-emerald-500/10 text-emerald-400',
  },
  amber: {
    glow: 'bg-amber-500/5 group-hover:bg-amber-500/10',
    icon: 'bg-amber-500/10 text-amber-400',
  },
  cyan: { glow: 'bg-cyan-500/5 group-hover:bg-cyan-500/10', icon: 'bg-cyan-500/10 text-cyan-400' },
} as const;

/** One figure of the strip, as the design's KPI box. */
export const BoardKpi = ({
  tone,
  icon,
  label,
  value,
  valueClass = 'text-white',
  unit,
  unitClass = 'text-slate-400 font-normal',
  note,
  hoverBorder = 'hover:border-slate-700',
  testId,
}: {
  tone: keyof typeof KPI_TONE;
  icon: readonly string[];
  label: string;
  value: string;
  valueClass?: string;
  unit: string;
  unitClass?: string;
  note: ReactNode;
  hoverBorder?: string;
  testId: string;
}): JSX.Element => (
  <div
    data-fuel-kpi={testId}
    className={cn(
      'group relative overflow-hidden rounded-xl border border-slate-800 bg-[#111827] p-4 transition',
      hoverBorder,
    )}
  >
    <div
      className={cn(
        'absolute -bottom-6 -left-6 h-24 w-24 rounded-full blur-xl transition',
        KPI_TONE[tone].glow,
      )}
    />
    <div className="mb-2 flex items-center justify-between">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <span className={cn('rounded-lg p-2', KPI_TONE[tone].icon)}>
        <Svg d={icon} className="h-4 w-4" />
      </span>
    </div>
    <div className="flex items-baseline gap-2">
      <span className={cn('text-2xl font-black', NUM, valueClass)}>{value}</span>
      <span className={cn('text-xs', unitClass)}>{unit}</span>
    </div>
    <div className="mt-2 flex items-center gap-1 text-[11px] font-medium">{note}</div>
  </div>
);

// ── The badges ─────────────────────────────────────────────────────────────────────────────────

/** The company's mark in the design's small square badge — Wataniya's logo, Chill Out's red. */
export const CompanyBadge = ({
  company,
  size = 'sm',
}: {
  company: FleetFuelCardCompany;
  size?: 'sm' | 'lg';
}): JSX.Element => (
  <div
    data-fuel-company={company}
    className={cn(
      'flex shrink-0 items-center justify-center overflow-hidden shadow-sm',
      size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-11 w-11 rounded-xl',
      company === 'wataniya'
        ? 'border border-emerald-500/40 bg-white p-0.5'
        : 'border border-red-500/50 bg-[#bf2726]',
    )}
  >
    <img
      src={company === 'wataniya' ? FUEL_CARD_LOGO.wataniya : CHILLOUT_SQUARE}
      alt=""
      className="h-full w-full object-contain"
    />
  </div>
);

/** «ساري» / «ينتهي قريباً» / «منتهي» beside the date. */
const ExpiryTag = ({ state }: { state: ExpiryState }): JSX.Element | null => {
  const t = useT();
  if (state === 'unknown') return null;
  return (
    <span
      data-fuel-expiry={state}
      className={cn(
        'rounded border px-1 py-[0.05rem] text-[11px] font-medium',
        state === 'valid' && 'border-emerald-800/50 bg-emerald-950 text-emerald-400',
        state === 'soon' && 'border-amber-700/50 bg-amber-950 text-amber-400',
        state === 'expired' && 'border-red-700/50 bg-red-950 text-red-400',
      )}
    >
      {t(`fleet.fuelCards.expiry.${state}`)}
    </span>
  );
};

// ── One card's line ───────────────────────────────────────────────────────────────────────────

const COMPANY_TONE: Record<FleetFuelCardCompany, { text: string; dot: string; hover: string }> = {
  wataniya: { text: 'text-emerald-400', dot: 'bg-emerald-400', hover: 'hover:text-emerald-400' },
  chillout: { text: 'text-amber-400', dot: 'bg-amber-400', hover: 'hover:text-amber-400' },
};

/** The PIN behind its eye — fetched under its own grant only when the eye is pressed. */
const PinBox = ({ card }: { card: FleetFuelCardDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [shown, setShown] = useState<string | null>(null);
  const reveal = async (): Promise<void> => {
    const { password } = await revealFuelCardPassword(card.id);
    setShown(password ?? '');
  };
  const mayReveal = card.hasPassword && can('fleetFuelCard.reveal');
  return (
    <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0b0f19] px-2 py-1">
      <span className="font-mono text-sm text-slate-500">{t('fleet.fuelCards.board.pin')}</span>
      <span className={cn('text-base font-bold tracking-widest text-slate-200', NUM)} dir="ltr">
        {shown === null ? (card.hasPassword ? '••••' : '—') : shown === '' ? '—' : shown}
      </span>
      {shown !== null ? (
        <button
          type="button"
          data-fuel-hide={card.id}
          title={t('fleet.fuelCards.hide')}
          aria-label={t('fleet.fuelCards.hide')}
          onClick={() => setShown(null)}
          className={cn('p-0.5 text-slate-500 transition', COMPANY_TONE[card.company].hover)}
        >
          <Svg d={PATH.eyeOff} className="h-3.5 w-3.5" />
        </button>
      ) : (
        mayReveal && (
          <button
            type="button"
            data-fuel-reveal={card.id}
            title={t('fleet.fuelCards.board.pinToggle')}
            aria-label={t('fleet.fuelCards.reveal')}
            onClick={() => void reveal()}
            className={cn('p-0.5 text-slate-500 transition', COMPANY_TONE[card.company].hover)}
          >
            <Svg d={PATH.eye} className="h-3.5 w-3.5" />
          </button>
        )
      )}
    </div>
  );
};

/** The number, in fours, with its copy button. */
const NumberBox = ({ card }: { card: FleetFuelCardDto }): JSX.Element => {
  const t = useT();
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(card.number);
    toast.success(t('fleet.fuelCards.numberCopied'));
  };
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#0b0f19] px-2.5 py-1">
      <span
        data-fuel-number={card.id}
        dir="ltr"
        className={cn('text-base font-bold tracking-wider text-slate-200', NUM)}
      >
        {groupCardNumber(card.number)}
      </span>
      <button
        type="button"
        data-fuel-copy={card.id}
        title={t('fleet.fuelCards.copyNumber')}
        aria-label={t('fleet.fuelCards.copyNumber')}
        onClick={() => void copy()}
        className={cn('p-0.5 text-slate-500 transition', COMPANY_TONE[card.company].hover)}
      >
        <Svg d={PATH.copy} className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export const FuelCardRow = ({
  card,
  warnDays,
  onEdit,
  onDelete,
  onPhoto,
}: {
  card: FleetFuelCardDto;
  warnDays: number;
  onEdit: (card: FleetFuelCardDto) => void;
  onDelete: (card: FleetFuelCardDto) => void;
  onPhoto: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const tone = COMPANY_TONE[card.company];
  return (
    <div
      data-fuel-line={card.company}
      data-fuel-card={card.id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#111827] px-3 py-2.5 transition hover:border-slate-700/80 hover:shadow-md"
    >
      <div className="flex min-w-[210px] items-center gap-3">
        <CompanyBadge company={card.company} />
        <div className="flex flex-col">
          <span className="whitespace-nowrap font-mono text-base font-bold tracking-wide text-white">
            {card.name}
          </span>
          <span className={cn('mt-0.5 flex items-center gap-1 text-sm font-medium', tone.text)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
            {t(`fleet.fuelCards.company.${card.company}`)}
          </span>
        </div>
      </div>

      <div className="my-auto flex flex-wrap items-center gap-3 sm:gap-4">
        <NumberBox card={card} />
        <div className={cn('flex items-center gap-1.5 text-base text-slate-300', NUM)}>
          <Svg d={PATH.calendar} className="h-4 w-4 text-slate-500" />
          <span className="font-semibold text-slate-200" dir="ltr">
            {ymd(card.expiresAt)}
          </span>
          <ExpiryTag state={expiryState(card.expiresAt, warnDays)} />
        </div>
        <PinBox card={card} />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          data-fuel-image={card.id}
          title={t('fleet.fuelCards.board.photo')}
          onClick={() => onPhoto(card)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white"
        >
          <Svg d={PATH.image} className={cn('h-3.5 w-3.5', tone.text)} />
          <span>{t('fleet.fuelCards.board.photo')}</span>
        </button>
        {can('fleetFuelCard.edit') && (
          <button
            type="button"
            data-fuel-edit={card.id}
            title={t('fleet.fuelCards.board.edit')}
            aria-label={t('fleet.fuelCards.board.edit')}
            onClick={() => onEdit(card)}
            className="rounded-md border border-slate-700/80 bg-slate-800/80 p-1.5 text-slate-400 transition hover:bg-blue-950/40 hover:text-blue-400"
          >
            <Svg d={PATH.edit} className="h-3.5 w-3.5" />
          </button>
        )}
        {can('fleetFuelCard.delete') && (
          <button
            type="button"
            data-fuel-delete={card.id}
            title={t('fleet.fuelCards.board.delete')}
            aria-label={t('fleet.fuelCards.board.delete')}
            onClick={() => onDelete(card)}
            className="rounded-md border border-slate-700/80 bg-slate-800/80 p-1.5 text-slate-400 transition hover:bg-red-950/40 hover:text-red-400"
          >
            <Svg d={PATH.trash} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

/** A free slot: «خانة الكارت الثاني شاغرة», with the link to fill it. */
export const EmptySlotRow = ({
  company,
  onLink,
}: {
  company: FleetFuelCardCompany;
  onLink?: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      data-fuel-line={company}
      data-fuel-empty={company}
      onClick={onLink}
      className={cn(
        'group flex items-center justify-between rounded-xl border border-dashed border-slate-700/70 bg-[#111827]/40 px-4 py-2.5 transition',
        onLink !== undefined && 'cursor-pointer hover:border-emerald-500/40 hover:bg-emerald-500/5',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 transition group-hover:border-emerald-500/30 group-hover:text-emerald-400">
          <Svg d={PATH.plus} className="h-4 w-4" />
        </span>
        <div>
          <span className="text-sm font-semibold text-slate-300 transition group-hover:text-emerald-300">
            {t('fleet.fuelCards.board.slotTitle', {
              company: t(`fleet.fuelCards.company.${company}`),
            })}
          </span>
          <p className="text-sm text-slate-500 group-hover:text-slate-400">
            {t('fleet.fuelCards.board.slotHint')}
          </p>
        </div>
      </div>
      {onLink !== undefined && (
        <button
          type="button"
          data-fuel-add={company}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-3 py-1.5 text-sm font-bold text-emerald-400 transition group-hover:bg-emerald-600/30"
        >
          <Svg d={PATH.link} className="h-3.5 w-3.5" />
          <span>{t('fleet.fuelCards.board.slotLink')}</span>
        </button>
      )}
    </div>
  );
};

/** A car holding no card at all. */
export const NoCardsBody = ({
  onLink,
  onAdd,
}: {
  onLink?: () => void;
  onAdd?: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="m-2.5 flex flex-1 flex-col items-center justify-between gap-4 rounded-xl border border-dashed border-slate-700/90 bg-[#0c121e]/80 p-4 shadow-inner sm:flex-row">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-sm">
          <Svg d={PATH.warn} className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <h4 className="text-sm font-bold tracking-wide text-white">
            {t('fleet.fuelCards.board.noneTitle')}
          </h4>
          <p className="mt-0.5 text-[11px] text-slate-300">{t('fleet.fuelCards.board.noneHint')}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2.5">
        {onLink !== undefined && (
          <button
            type="button"
            data-fuel-link-stock="true"
            onClick={onLink}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-3.5 py-2 text-sm font-bold text-emerald-300 shadow-sm transition hover:bg-emerald-600/30 hover:text-emerald-200"
          >
            <Svg d={PATH.link} className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t('fleet.fuelCards.board.linkFromStock')}</span>
          </button>
        )}
        {onAdd !== undefined && (
          <button
            type="button"
            data-fuel-add="any"
            onClick={onAdd}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-bold text-slate-100 shadow-sm transition hover:bg-slate-700"
          >
            <Svg d={PATH.plus} className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t('fleet.fuelCards.board.addNew')}</span>
          </button>
        )}
      </div>
    </div>
  );
};

/** One car's block: its code and slot count down the side, its lines beside. */
export const VehicleFuelGroup = ({
  vehicleId,
  code,
  held,
  children,
}: {
  vehicleId: string;
  code: string;
  /** How many of its two slots hold a card. */
  held: number;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  const status =
    held >= 2
      ? {
          chip: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40 font-semibold',
          dot: 'bg-emerald-400 animate-pulse',
          text: t('fleet.fuelCards.board.linkedMany', { count: String(held) }),
          box: 'bg-slate-800/70 border-slate-700/70 text-slate-400 font-medium cursor-not-allowed',
          boxText: t('fleet.fuelCards.board.full'),
          boxTitle: t('fleet.fuelCards.board.fullTitle'),
          lock: true,
        }
      : held === 1
        ? {
            chip: 'bg-amber-950/80 text-amber-400 border-amber-700/50 font-semibold',
            dot: 'bg-amber-400 animate-pulse',
            text: t('fleet.fuelCards.board.linkedOne'),
            box: 'bg-amber-500/10 border-amber-500/30 text-amber-400 font-bold',
            boxText: t('fleet.fuelCards.board.half'),
            boxTitle: t('fleet.fuelCards.board.halfTitle'),
            lock: false,
          }
        : {
            chip: 'bg-red-950/60 text-red-400 border-red-700/50 font-bold',
            dot: 'bg-red-400',
            text: t('fleet.fuelCards.board.linkedNone'),
            box: 'bg-slate-800/80 border-slate-700 text-slate-300 font-semibold',
            boxText: t('fleet.fuelCards.board.zero'),
            boxTitle: t('fleet.fuelCards.board.zeroTitle'),
            lock: false,
          };
  return (
    <article
      data-fuel-tile={vehicleId}
      data-fuel-held={held}
      className="overflow-hidden rounded-2xl border border-slate-800 bg-[#111827] shadow-sm transition-all duration-200 hover:border-slate-700/80"
    >
      <div className="flex flex-col items-stretch lg:flex-row">
        <div className="flex w-full shrink-0 flex-col justify-between border-b border-slate-800 bg-gradient-to-b from-slate-900 via-[#11192b] to-[#0c121e] p-3 lg:w-52 lg:border-b-0 lg:border-l">
          <div className="flex flex-1 flex-col items-center justify-center space-y-1 py-1.5 text-center">
            <span
              className={cn(
                'text-[11px] font-semibold',
                held === 0 ? 'text-slate-300' : 'text-slate-400',
              )}
            >
              {t('fleet.fuelCards.board.carCode')}
            </span>
            <div
              data-fuel-code={code}
              className={cn(
                'rounded-lg border px-3.5 py-0.5 font-black shadow-inner',
                // A car's code and a label on no car («سفر 1», «اسبير») are the same size — the code in
                // the figures' monospace, the label in the words' type.
                'text-2xl tracking-wider md:text-3xl',
                /^\d+$/u.test(code) && NUM,
                held === 0
                  ? 'border-slate-700 bg-slate-800 text-white'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
              )}
            >
              {code}
            </div>
          </div>
          <div className="w-full space-y-1 border-t border-slate-800/80 pt-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className={cn('font-medium', held === 0 ? 'text-slate-300' : 'text-slate-400')}>
                {t('fleet.fuelCards.board.status')}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]',
                  status.chip,
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
                {status.text}
              </span>
            </div>
            <div
              title={status.boxTitle}
              className={cn(
                'flex items-center justify-center gap-1 rounded border px-2 py-0.5 text-[10px]',
                status.box,
              )}
            >
              {status.lock && <Svg d={PATH.lock} className="h-3 w-3 text-slate-500" />}
              <span>{status.boxText}</span>
            </div>
          </div>
        </div>
        {held === 0 ? (
          children
        ) : (
          <div className="flex flex-1 flex-col justify-center space-y-2 bg-[#0c121e]/50 p-2.5">
            {children}
          </div>
        )}
      </div>
    </article>
  );
};

// ── The stock: cards on no car ────────────────────────────────────────────────────────────────

export const StockSection = ({
  cards,
  onAdd,
  onAssign,
  onPhoto,
  onDelete,
}: {
  cards: readonly FleetFuelCardDto[];
  onAdd?: () => void;
  onAssign: (card: FleetFuelCardDto) => void;
  onPhoto: (card: FleetFuelCardDto) => void;
  onDelete: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  return (
    <section
      data-fuel-stock="true"
      aria-label={t('fleet.fuelCards.board.stockTitle')}
      className="space-y-4 rounded-2xl border border-dashed border-slate-700/90 bg-[#111827] p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
            <Svg d={PATH.box} className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">
                {t('fleet.fuelCards.board.stockTitle')}
              </h3>
              <span className="rounded border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-sm font-bold text-amber-400">
                {t('fleet.fuelCards.board.stockCount', { count: String(cards.length) })}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-400">{t('fleet.fuelCards.board.stockHint')}</p>
          </div>
        </div>
        {onAdd !== undefined && (
          <button
            type="button"
            data-fuel-stock-add="true"
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <Svg d={PATH.plus} className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t('fleet.fuelCards.board.stockAdd')}</span>
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {cards.map((card) => (
          <div
            key={card.id}
            data-fuel-card={card.id}
            data-fuel-no-car="true"
            className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-slate-800 bg-[#0c121e]/80 p-3.5 transition hover:border-slate-700 sm:flex-row sm:items-center"
          >
            <div className="flex items-center gap-3">
              <CompanyBadge company={card.company} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-white">{card.name}</span>
                  {/* The label it is known by on the fuel screens — «سفر 1», «اسبير». */}
                  {card.label !== null && card.label !== card.name && (
                    <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-[0.05rem] text-[11px] font-semibold text-slate-200">
                      {card.label}
                    </span>
                  )}
                  <span className="rounded border border-amber-700/50 bg-amber-950/80 px-1.5 py-[0.05rem] text-[11px] font-medium text-amber-400">
                    {t('fleet.fuelCards.board.unlinked')}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  <span dir="ltr">{groupCardNumber(card.number)}</span> •{' '}
                  {t('fleet.fuelCards.board.expiresOn', { date: ymd(card.expiresAt) })}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-2 sm:border-t-0 sm:pt-0">
              {can('fleetFuelCard.edit') && (
                <button
                  type="button"
                  data-fuel-assign={card.id}
                  onClick={() => onAssign(card)}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-3 py-1.5 text-sm font-bold text-emerald-400 transition hover:bg-emerald-600/30 hover:text-emerald-300"
                >
                  <Svg d={PATH.link} className="h-3.5 w-3.5" />
                  <span>{t('fleet.fuelCards.board.assign')}</span>
                </button>
              )}
              <button
                type="button"
                data-fuel-image={card.id}
                title={t('fleet.fuelCards.board.preview')}
                aria-label={t('fleet.fuelCards.board.preview')}
                onClick={() => onPhoto(card)}
                className="rounded-lg border border-slate-700/80 bg-slate-800/80 p-1.5 text-slate-400 transition hover:text-slate-200"
              >
                <Svg d={PATH.eye} className="h-3.5 w-3.5" />
              </button>
              {can('fleetFuelCard.delete') && (
                <button
                  type="button"
                  data-fuel-delete={card.id}
                  title={t('fleet.fuelCards.board.delete')}
                  aria-label={t('fleet.fuelCards.board.delete')}
                  onClick={() => onDelete(card)}
                  className="rounded-lg border border-slate-700/80 bg-slate-800/80 p-1.5 text-slate-400 transition hover:bg-red-950/40 hover:text-red-400"
                >
                  <Svg d={PATH.trash} className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
