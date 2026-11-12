// The pieces «توزيع المحصنات» and «تسليم المحصنات» (Round 12) are both drawn from — the van's card,
// the shipment's card, the «نقل إلى…» menu and the two columns — so the vault sees each van exactly as
// Operations placed it: «نفس الشاشة هنعمل زيها للخزنة».
//
// THE LOOK. The boards' (`ShipmentsBoard.tsx`, `BoardFigures.tsx`): white and slate by day, the
// boards' navy by night, Cairo's bold for every value, the figures' face for numbers, the stage
// badges the boards print («بالخزينة» green, «تم الاستلام من القائد» yellow…). A van is a card — what
// the crew board plans for the day (number, captains, both specialists, direction, time) — with
// its load under it; a shipment is a small card of what the table prints in a row (bank, from → to,
// area, the money, the stage).
//
// RTL: the vans are the FIRST column, so they stand on the RIGHT («العربيات على اليمين»), the
// shipments on the LEFT («والمحصنات على الشمال»); at phone width the columns stack, vans first.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type Locale,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { FILTER_ICON, FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { Input } from '../../../shared/ui/form';
import { type LoadFigures, type Packaging, personName } from '../lib/secured-distribution';
import { ltrIsolate } from '../lib/shipment-log';
import { SecuredStageBadge } from './ShipmentBadges';
import { SHIPMENT_PATH } from './shipment-icons';

/** What a drag carries — our own type, so a file or a link dragged over a van is not taken. */
export const SHIPMENT_DRAG_TYPE = 'application/x-ecms-secured-shipment';

/** Does this drag carry one of the screen's shipments? */
export const carriesShipment = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer.types).includes(SHIPMENT_DRAG_TYPE);

/**
 * The day's bar — the boards' filter surface (`DARK_FILTER_BAR`'s box and input colours) holding the
 * day, and what the screen has to say about it. Not the boards' one-row layout: it holds one box,
 * not nine that share a row.
 */
export const DAY_BAR = cn(
  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#111827]',
  '[&_input]:!border-slate-300 dark:[&_input]:!border-slate-700/80 [&_input]:!bg-slate-50 dark:[&_input]:!bg-[#080C14] [&_input]:!text-slate-900 dark:[&_input]:!text-slate-100',
);

/**
 * The day — «يوم التسليم» — as the boards' date box draws a day (`BoardDateBox`: the calendar at its
 * start, its name written beside the date), with a floor: no day before today (`min`), the boards'
 * «no past day» rule.
 */
export const DayBox = ({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  onChange: (value: string) => void;
}): JSX.Element => (
  <FilterWithIcon
    icon={FILTER_ICON.calendar}
    tone="text-cyan-600 dark:text-cyan-400"
    className="w-48 shrink-0 [container-type:inline-size]"
    datePicker={{ label }}
  >
    <Input
      type="date"
      dir="ltr"
      density="tight"
      data-distribution-day="true"
      aria-label={label}
      title={label}
      value={value}
      min={min}
      onChange={(event) => onChange(event.target.value)}
      className="dark:[color-scheme:dark] [&::-webkit-datetime-edit-fields-wrapper]:py-0 [[dir=ltr]_&]:text-right"
    />
    <span
      aria-hidden
      className="pointer-events-none absolute start-6 top-0 hidden h-9 items-center text-xs font-bold text-slate-500 dark:text-slate-400 [@container(min-width:10rem)]:flex"
    >
      {label}
    </span>
  </FilterWithIcon>
);

/**
 * A column: a panel with its head, whose body scrolls inside the viewport on a computer (the page
 * keeps its toolbar and the other column in view) and with the page on a phone.
 */
export const DistributionColumn = ({
  title,
  count,
  icon,
  extra,
  children,
  bodyProps,
  ...rest
}: {
  title: string;
  count: number;
  icon: readonly string[];
  extra?: ReactNode;
  children: ReactNode;
  /** The body's own props — the shipments column is a drop target («إزالة» by drag). */
  bodyProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
} & Record<`data-${string}`, string>): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <section
      {...rest}
      className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-[#0b1226] lg:min-h-0"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300">
          <BoardIcon d={[...icon]} className="h-4 w-4" />
        </span>
        <h2 className="text-[15px] font-black text-slate-900 dark:text-white">{title}</h2>
        <span
          className={cn(
            'rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-black text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
            NUM,
          )}
        >
          {formatNumber(count, locale)}
        </span>
        {extra}
      </header>
      <div
        {...bodyProps}
        className={cn(
          'min-h-[10rem] flex-1 p-3 lg:min-h-0 lg:overflow-y-auto',
          bodyProps?.className,
        )}
      >
        {children}
      </div>
    </section>
  );
};

/** A money chip: the amount in the figures' face, then what it is. */
const MoneyChip = ({
  value,
  label,
  tone,
  ...rest
}: {
  value: number;
  label: string;
  tone: string;
} & Record<`data-${string}`, string>): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <span
      {...rest}
      className="inline-flex items-baseline gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-bold dark:border-slate-700/70 dark:bg-[#0a1233]"
    >
      <span dir="ltr" className={cn(NUM, 'text-[12px] font-black', tone)}>
        {formatAmount(value, locale)}
      </span>
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
    </span>
  );
};

/** The money a shipment (or a whole load) carries: the pound, the dollar, «عملات أخرى» — the non-zero ones. */
export const MoneyLine = ({
  figures,
  packages,
  showZero = false,
}: {
  figures: Pick<LoadFigures, 'egp' | 'usd' | 'othersSum'>;
  packages?: Packaging | null | undefined;
  /** A van's total says «0» rather than nothing — an empty van is a fact worth reading. */
  showZero?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const any = figures.egp !== 0 || figures.usd !== 0 || figures.othersSum !== 0;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {(showZero || figures.egp !== 0 || !any) && (
        <MoneyChip
          data-money="EGP"
          value={figures.egp}
          label={t('operations.reportBoard.pound')}
          tone="text-emerald-700 dark:text-emerald-300"
        />
      )}
      {(showZero || figures.usd !== 0) && (
        <MoneyChip
          data-money="USD"
          value={figures.usd}
          label={t('operations.reportBoard.dollar')}
          tone="text-sky-700 dark:text-sky-300"
        />
      )}
      {(showZero || figures.othersSum !== 0) && (
        <MoneyChip
          data-money="others"
          value={figures.othersSum}
          label={t('operations.board.figures.otherCurrencies')}
          tone="text-amber-700 dark:text-amber-300"
        />
      )}
      {packages !== undefined && packages !== null && (
        // The kinds the vault counted, each with its count — a zero kind is left out (an Arabic
        // zero reads as one more dot between the others).
        <span
          data-packages={`${packages.bags}/${packages.cartons}/${packages.boxes}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-600 dark:border-slate-700/70 dark:bg-[#0a1233] dark:text-slate-300"
        >
          <BoardIcon d={[...PATH.box]} className="h-3 w-3" />
          {(
            [
              ['bags', packages.bags],
              ['cartons', packages.cartons],
              ['boxes', packages.boxes],
            ] as const
          )
            .filter(([, value], _index, all) => value > 0 || all.every(([, v]) => v === 0))
            .map(([kind, value], index) => (
              <span key={kind} className="inline-flex items-center gap-1">
                {index > 0 && <span className="text-slate-300 dark:text-slate-600">|</span>}
                <span dir="ltr" className={cn(NUM, 'font-black text-slate-900 dark:text-white')}>
                  {formatAmount(value, locale)}
                </span>
                {t(`operations.distribution.${kind}`)}
              </span>
            ))}
        </span>
      )}
    </div>
  );
};

/** A small pill on a card — a mark, never a button. */
export const CardMark = ({
  tone,
  children,
  title,
  ...rest
}: {
  tone: 'proposed' | 'moved' | 'overdue' | 'started' | 'refused' | 'waiting' | 'reschedule';
  children: ReactNode;
  title?: string;
} & Record<`data-${string}`, string>): JSX.Element => (
  <span
    {...rest}
    title={title}
    className={cn(
      'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-black ring-1 ring-inset',
      {
        proposed:
          'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/40',
        moved:
          'bg-brand-100 text-brand-700 ring-brand-300 dark:bg-brand-500/20 dark:text-brand-200 dark:ring-brand-400/40',
        overdue:
          'bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/40',
        refused: 'bg-rose-600 text-white ring-rose-700 dark:bg-rose-500 dark:ring-rose-300/60',
        started:
          'bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700/60 dark:text-slate-200 dark:ring-slate-500/50',
        waiting:
          'bg-slate-100 text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/60',
        reschedule:
          'bg-violet-100 text-violet-700 ring-violet-300 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-400/40',
      }[tone],
    )}
  >
    {children}
  </span>
);

/** One choice of the «نقل إلى…» menu. */
export interface MoveChoice {
  key: string;
  label: string;
  /** A second line — the van's captain and direction. */
  sub?: string;
  /** Where the shipment is now: listed, not offered. */
  current?: boolean;
  /** Offered but not takeable (a van with no captain), with why. */
  disabledReason?: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * «نقل إلى…» — the keyboard's (and the phone's) way to move a shipment: every van of the day, and
 * «إزالة من السيارة» when it is on one. A real menu: it opens on Enter/Space, the arrows walk it,
 * Escape closes it and gives the focus back. Drawn in a layer of its own over the page (a portal,
 * placed by the button), so the scrolling column it sits in never clips it.
 */
export const MoveMenu = ({
  label,
  choices,
  rowId,
}: {
  label: string;
  choices: readonly MoveChoice[];
  rowId: string;
}): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  // Placed under the button (over it near the bottom of the screen), kept inside the viewport — and
  // kept there while anything under it scrolls (the column, the page) or the window is resized. An
  // effect, not a layout effect: the menu is drawn only once placed, so nothing shows unplaced.
  useEffect(() => {
    if (!open) return undefined;
    const reposition = (): void => {
      if (button.current === null) return;
      const rect = button.current.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      const up = rect.bottom + 320 > window.innerHeight && rect.top > 320;
      setPlace({ top: up ? rect.top - 4 : rect.bottom + 4, left, up });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  // The first choice takes the focus when the menu opens (once — not on every re-placing).
  const placed = place !== null;
  useEffect(() => {
    if (!open || !placed) return;
    menu.current
      ?.querySelector<HTMLButtonElement>('[role=menuitem]:not([disabled])')
      ?.focus({ preventScroll: true });
  }, [open, placed]);

  const items = (): HTMLButtonElement[] =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not([disabled])') ?? [],
    );
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      setOpen(false);
      setPlace(null);
      button.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
    list[(next + list.length) % list.length]?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        data-move-open={rowId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) setPlace(null);
          setOpen((value) => !value);
        }}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-slate-600 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-brand-500/15 dark:hover:text-brand-100"
      >
        <BoardIcon d={[...PATH.truck]} className="h-3.5 w-3.5" />
        {label}
      </button>
      {open &&
        place !== null &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            data-move-menu={rowId}
            onKeyDown={onKey}
            style={{
              position: 'fixed',
              top: place.top,
              left: place.left,
              transform: place.up ? 'translateY(-100%)' : undefined,
            }}
            className="z-[70] max-h-80 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-900/15 animate-menu-in dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/60"
          >
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                role="menuitem"
                data-move-choice={choice.key}
                disabled={choice.current === true || choice.disabledReason !== undefined}
                title={choice.disabledReason}
                onClick={() => {
                  setOpen(false);
                  setPlace(null);
                  button.current?.focus({ preventScroll: true });
                  choice.onSelect();
                }}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-start transition focus:outline-none',
                  'enabled:hover:bg-brand-500/10 enabled:focus-visible:bg-brand-500/15 disabled:cursor-default',
                  choice.current === true && 'bg-slate-100 dark:bg-slate-800/70',
                  choice.disabledReason !== undefined && 'opacity-50',
                )}
              >
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-sm font-black',
                    choice.danger === true
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-900 dark:text-white',
                  )}
                >
                  {choice.label}
                </span>
                {choice.sub !== undefined && choice.sub !== '' && (
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {choice.sub}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

/** The names of a crew slot, joined — «…» for a person the directory cannot name. */
const names = (people: readonly OperationsDayBoardPersonDto[]): string =>
  people.map(personName).join(' · ');

/** One line of the van's crew: its name, then who. */
const CrewLine = ({ label, value }: { label: string; value: ReactNode }): JSX.Element => (
  <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
    <span className="shrink-0 font-bold text-slate-500 dark:text-slate-400">{label}</span>
    <span className="min-w-0 font-bold text-slate-800 dark:text-slate-100">{value}</span>
  </div>
);

/**
 * THE VAN — the crew board's row for the day: its number, planned time and direction, its
 * captain(s) and both specialists, what it carries (how many, how much), then its load. The card is
 * the drop target (`drop`); while a shipment is dragged every van that can take one shows it, and
 * the one under the pointer lights up.
 */
export const VanCard = ({
  van,
  crewPlanVisible,
  figures,
  actions,
  drop,
  children,
  footer,
}: {
  van: OperationsDayBoardVehicleCrewDto;
  crewPlanVisible: boolean;
  figures: LoadFigures;
  /** Above the van — the vault's «تسليم» and «طباعة». */
  actions?: ReactNode;
  drop?: {
    /** A shipment is being dragged and this van can take it. */
    armed: boolean;
    /** It is under the pointer. */
    over: boolean;
    handlers: Pick<
      HTMLAttributes<HTMLElement>,
      'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'
    >;
  };
  children: ReactNode;
  /** Under the load — the vault's «not in the vault yet» note. */
  footer?: ReactNode;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const noCaptain = van.captains.length === 0;
  return (
    <article
      data-distribution-van={van.crewAssignmentId}
      data-drop-over={drop?.over === true ? 'true' : undefined}
      data-drop-armed={drop?.armed === true ? 'true' : undefined}
      aria-label={t('operations.distribution.vanLabel', { code: van.vehicleCode ?? '…' })}
      {...drop?.handlers}
      className={cn(
        'flex min-w-0 flex-col gap-2.5 rounded-xl border bg-white p-3 shadow-sm transition-[box-shadow,border-color,background-color] dark:bg-[#111827]',
        'border-slate-200 dark:border-[#24305a]',
        drop?.armed === true &&
          !drop.over &&
          'border-dashed border-brand-300 dark:border-brand-500/50',
        drop?.over === true &&
          'border-brand-500 bg-brand-50 shadow-lg shadow-brand-500/20 ring-2 ring-brand-500 dark:border-brand-400 dark:bg-brand-500/10 dark:ring-brand-400',
        noCaptain && 'opacity-80',
      )}
    >
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2.5 dark:border-slate-800">
          {actions}
        </div>
      )}
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <BoardIcon d={[...PATH.truck]} className="h-5 w-5" />
        </span>
        <span
          dir="ltr"
          data-van-code={van.vehicleCode ?? ''}
          className={cn('text-lg font-black text-slate-900 dark:text-white', NUM)}
        >
          {van.vehicleCode ?? '…'}
        </span>
        {van.plannedTime !== null && van.plannedTime !== '' && (
          <span
            title={t('operations.crew.plannedTime')}
            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <BoardIcon d={[...PATH.calendar]} className="h-3 w-3" />
            <span dir="ltr" className={NUM}>
              {van.plannedTime}
            </span>
          </span>
        )}
        <span
          data-van-count={figures.count}
          className={cn(
            'ms-auto rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-black text-brand-700 dark:text-brand-200',
          )}
        >
          {t('operations.distribution.loadCount', { count: formatNumber(figures.count, locale) })}
        </span>
      </header>
      <div
        data-van-direction={van.direction ?? ''}
        className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2 py-1 text-[13px] font-black text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200"
      >
        <BoardIcon d={[...SHIPMENT_PATH.route]} className="h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" />
        <span className="shrink-0 text-[11px] font-bold opacity-80">
          {t('operations.crew.direction')}
        </span>
        <span className="min-w-0 truncate">
          {van.direction === null || van.direction.trim() === ''
            ? t('operations.distribution.noDirection')
            : van.direction}
        </span>
      </div>
      <div className="grid gap-1">
        <CrewLine
          label={t(
            van.captains.length > 1
              ? 'operations.distribution.captains'
              : 'operations.crew.slot.captain',
          )}
          value={
            noCaptain ? (
              <span className="text-rose-600 dark:text-rose-400">
                {t('operations.distribution.noCaptain')}
              </span>
            ) : (
              names(van.captains)
            )
          }
        />
        {crewPlanVisible ? (
          <>
            <CrewLine
              label={t('operations.crew.slot.specialist1')}
              value={van.specialist1.length === 0 ? '—' : names(van.specialist1)}
            />
            <CrewLine
              label={t('operations.crew.slot.specialist2')}
              value={van.specialist2.length === 0 ? '—' : names(van.specialist2)}
            />
          </>
        ) : null}
      </div>
      <div data-van-figures={van.crewAssignmentId}>
        <MoneyLine figures={figures} packages={figures.packages} showZero />
      </div>
      <div
        className={cn(
          'flex min-h-[3.5rem] flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors',
          'border-slate-200 dark:border-slate-700/70',
          drop?.over === true && 'border-brand-400 dark:border-brand-400/70',
        )}
      >
        {children}
      </div>
      {footer}
    </article>
  );
};

/** A load's empty place — what to do with it, said where the shipments would be. */
export const EmptyLoad = ({ children }: { children: ReactNode }): JSX.Element => (
  <p className="flex flex-1 items-center justify-center px-2 py-3 text-center text-xs font-bold text-slate-400 dark:text-slate-500">
    {children}
  </p>
);

/**
 * THE SHIPMENT — what the board's row prints, on a card: the bank, from → to, the area (the
 * direction it is matched on), the money, the stage. `marks` are what the screen has to say about
 * it (proposed, unsaved, overdue, started, refused), `controls` its acts (the captain switch, «نقل
 * إلى…»), `drag` makes it draggable.
 */
export const ShipmentCard = ({
  row,
  bankName,
  figures,
  packages,
  marks,
  controls,
  drag,
  tone,
}: {
  row: OperationsSecuredDistributionRowDto;
  bankName: string;
  figures: Pick<LoadFigures, 'egp' | 'usd' | 'othersSum'>;
  packages?: Packaging | null | undefined;
  marks?: ReactNode;
  controls?: ReactNode;
  drag?: {
    dragging: boolean;
    onDragStart: (event: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  /** The card's edge: a proposal (amber, dashed), an unsaved move (brand), a refusal (rose). */
  tone?: 'proposed' | 'moved' | 'refused' | undefined;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      data-distribution-shipment={row.id}
      data-shipment-tone={tone ?? 'saved'}
      draggable={drag !== undefined}
      onDragStart={drag?.onDragStart}
      onDragEnd={drag?.onDragEnd}
      className={cn(
        'group relative flex min-w-0 flex-col gap-1.5 rounded-lg border bg-white px-2.5 py-2 text-start shadow-sm dark:bg-[#0f1a3a]',
        'border-slate-200 dark:border-[#2b3b6b]',
        tone === 'proposed' &&
          'border-dashed border-amber-500 bg-amber-50 dark:border-amber-400/60 dark:bg-amber-400/[0.06]',
        tone === 'moved' &&
          'border-brand-400 bg-brand-50/60 dark:border-brand-400/60 dark:bg-brand-500/[0.08]',
        tone === 'refused' &&
          'border-rose-500 ring-1 ring-rose-500 dark:border-rose-400 dark:ring-rose-400',
        drag !== undefined && 'cursor-grab active:cursor-grabbing',
        drag?.dragging === true && 'opacity-40',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {drag !== undefined && (
          <span aria-hidden className="text-slate-300 dark:text-slate-600">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
              <circle cx="9" cy="6" r="1.6" />
              <circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" />
              <circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="18" r="1.6" />
            </svg>
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1 text-[14px] font-black text-slate-900 dark:text-white">
          <BoardIcon
            d={[...SHIPMENT_PATH.bank]}
            className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300"
          />
          <span className="truncate">{bankName === '' ? '…' : bankName}</span>
        </span>
        {row.securedStage !== null && <SecuredStageBadge stage={row.securedStage} />}
        {marks}
        {controls !== undefined && (
          <span className="ms-auto flex items-center gap-1">{controls}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-bold text-slate-600 dark:text-slate-300">
        <span className="min-w-0 truncate" title={t('operations.shipment.origin')}>
          {row.origin?.name ?? '…'}
        </span>
        <span aria-hidden className="text-slate-400 rtl:-scale-x-100">
          →
        </span>
        <span className="min-w-0 truncate" title={t('operations.shipment.destination')}>
          {row.destination?.name ?? '…'}
        </span>
        <span
          data-shipment-area={row.areaName ?? ''}
          className="ms-auto inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-px text-[11px] font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          title={t('operations.shipment.area')}
        >
          <BoardIcon d={[...SHIPMENT_PATH.route]} className="h-3 w-3 rtl:-scale-x-100" />
          {row.areaName ?? t('operations.distribution.noArea')}
        </span>
      </div>
      <MoneyLine figures={figures} packages={packages} />
    </div>
  );
};

/** The delivery day a card names (an overdue one's), year first inside Arabic. */
export const dayText = (iso: string | null): string =>
  iso === null ? '—' : ltrIsolate(iso.slice(0, 10));
