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
// shipments on the LEFT («والمحصنات على الشمال»); at phone width the columns stack.
//
// Round 24c — «عاوز اصغر المكان اللى فيه المحصنات واكبر المكان اللى فيه المحصنة بالعربيه»: the vans
// take three quarters of a wide screen and the محصنات on no van one (`DISTRIBUTION_COLUMNS`), the
// vans' cards as many to a row as fit (`VAN_GRID` — three at 1440). The van card's head is one line.
//
// Round 25 — «عاوز المحصنة تظهر صغيره عبارة عن البنك والفرع ولما اعمل هوفر عليها يجيب بقى معلومتها»
// and «شكل العربية بالمحصنات يتغير»: a محصنة is a small chip (`ShipmentChip` — bank · branch, its
// card on hover), the same on the left and on a van; the van card is its head, ONE captain's line led
// by the count, and the three package counts (`VanCard`); each column has a filter bar on top
// (`ColumnFilterBar`).
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type Locale,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { pluralKey } from '../../../shared/lib/plural';
import { useAppSelector } from '../../../store';
import { FILTER_ICON, FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  HOVER_CARD_FACTS,
  HoverCardFact,
  HoverCardLayer,
  HoverCardMissing,
  useHoverCard,
} from '../../fleet/components/HoverCardLayer';
import { Input, Select } from '../../../shared/ui/form';
import { useOperationsCrewDirectory } from '../api/operations-queries';
import { awayOf } from '../lib/crew-plan';
import {
  type LoadFigures,
  type Packaging,
  type PackagingRead,
  personName,
} from '../lib/secured-distribution';
import { ltrIsolate } from '../lib/shipment-log';
import {
  PACKAGE_KINDS,
  vanCrewGroups,
  vanHoverAllowed,
  vanTapAllowed,
  type CountKind,
  type VanAccent,
} from '../lib/van-accent';
import { hasNoVan, vanCodeText, vanPhrase } from '../lib/van-name';
import { CardHead, Figure, PersonIcon } from './BoardCrewCards';
import { PLAN_ICON } from './crew-plan-icons';
import { PlanAttendanceFact, PlanMemberCardBody } from './CrewPlanMemberCard';
import {
  CAPTAIN_BAND,
  CAPTAIN_MARK,
  COUNT_LOOK,
  COUNT_ZERO,
  HEAD_PILL,
  SHIPMENTS_BADGE,
  VAN_ACCENT_LOOK,
} from './distribution-look';
import { SecuredStageBadge, SecuredStageMark } from './ShipmentBadges';
import { SHIPMENT_PATH } from './shipment-icons';

/** What a drag carries — `lib/distribution-drag.ts` (Round 25), re-exported for the pages. */
export { SHIPMENT_DRAG_TYPE } from '../lib/distribution-drag';

/**
 * The two columns (Round 24c — «عاوز اصغر المكان اللى فيه المحصنات واكبر المكان اللى فيه المحصنة
 * بالعربيه»): from a computer's width the vans take three parts and the محصنات on no van one — about
 * 1/4 — never narrower than its cards read (17rem: at 1024 that column is wider than a quarter);
 * stacked on a phone.
 */
export const DISTRIBUTION_COLUMNS =
  'grid gap-4 lg:min-h-[24rem] lg:flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(17rem,1fr)]';

/**
 * The vans' cards: as many to a row as fit at 17.5rem or more — three at 1440, four on a 1920
 * screen, two at 1024 and 1280, one on a phone (`min(100%, …)`: a card never wider than its column).
 * R26 critic — and never more than FOUR: a card is at least a quarter of the column (less its three
 * gaps), so a 2560 screen lays four wider cards, not six — the card above is one to four places
 * back, which the colours' order keeps apart (`lib/van-accent.ts`).
 */
export const VAN_GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(min(100%,max(17.5rem,calc((100%_-_2.25rem)/4))),1fr))] items-start gap-3';

/**
 * A count on these screens (R26 critic) — in the figures' face, Latin digits (`formatAmount`), as
 * the money, the van's code and the van card's counts are: one numeral system on the page, and a 0
 * that reads as zero, never as a dot. A crew's NAME («بدون سيارة (n)») keeps the board's own words.
 */
export const countText = (value: number, locale: Locale): string => formatAmount(value, locale);

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
 *
 * Round 24c — `collapse`: below the computer's width the column's head is a button that folds its
 * body away (`aria-expanded`), so a long list of محصنات on no van never buries the vans on a phone.
 * Folded, the column still takes a drop on its head (`dropHandlers` are the whole section's).
 *
 * Round 26 — «عاوز الفلاتر دول يكونوا جمبب السيارات و بلا سيارات»: the filter bar is ON the head's
 * line, right after the title and its count — one row, no row of its own. `filtersFit` says how
 * much room the boxes need before they wrap under the title: `wide` (the vans' three boxes) or
 * `narrow` (the left column's two compact boxes, which share its quarter with the title at 1280 as
 * at 1440). A foldable column (a phone) puts them on a line of their own under its toggle. Folded,
 * the bar folds away with the body.
 */
export const DistributionColumn = ({
  title,
  count,
  icon,
  extra,
  children,
  bodyProps,
  dropHandlers,
  collapse,
  filters,
  filtersFit = 'wide',
  className,
  ...rest
}: {
  title: string;
  count: number;
  icon: readonly string[];
  extra?: ReactNode;
  /** The column's filter bar, on the head's line beside the title (Round 26). */
  filters?: ReactNode;
  /** How much of the head's line the bar needs before it wraps under the title. */
  filtersFit?: 'wide' | 'narrow';
  children: ReactNode;
  /** The body's own props — the look of a drop on the shipments column. */
  bodyProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  /** The drag's handlers, on the whole column — its head too, so a folded column takes a drop. */
  dropHandlers?: Pick<
    HTMLAttributes<HTMLElement>,
    'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'
  >;
  /** Foldable (a phone's width): whether it is open, and the fold. Omitted: always open. */
  collapse?: { open: boolean; onToggle: () => void };
  className?: string;
} & Record<`data-${string}`, string>): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const bodyId = useId();
  const open = collapse === undefined || collapse.open;
  const narrowBar = filters !== undefined && filtersFit === 'narrow';
  const head = (
    <>
      {/* Round 26 — a head narrower than its title and two boxes (the left column at 1280–1440)
          gives the boxes the room of its drawing; the title and the count stay. R26 critic: only
          a head that HAS the narrow boxes — the hand-over's left column has none, and keeps it. */}
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300',
          narrowBar && '[@container(max-width:20.5rem)]:hidden',
        )}
      >
        <BoardIcon d={[...icon]} className="h-4 w-4" />
      </span>
      <h2 className="whitespace-nowrap text-[15px] font-black text-slate-900 dark:text-white">
        {title}
      </h2>
      <span
        className={cn(
          'shrink-0 rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-black text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
          NUM,
        )}
      >
        {countText(count, locale)}
      </span>
    </>
  );
  return (
    <section
      {...rest}
      {...dropHandlers}
      data-column-open={collapse === undefined ? undefined : String(open)}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-[#0b1226] lg:min-h-0',
        className,
      )}
    >
      <header
        data-column-head="true"
        className={cn(
          'flex shrink-0 flex-wrap items-start gap-x-2 gap-y-2 px-3 py-2.5 [container-type:inline-size]',
          open && 'border-b border-slate-200 dark:border-slate-800',
        )}
      >
        {collapse === undefined ? (
          // As tall as the filter boxes beside it: the title stays on their line when the words of
          // a filter in use take a line of their own under them.
          <div
            data-column-title="true"
            className="flex min-h-[2.125rem] shrink-0 items-center gap-1.5"
          >
            {head}
          </div>
        ) : (
          <button
            type="button"
            data-column-toggle="true"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={collapse.onToggle}
            className="-m-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-lg p-1 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            {head}
            <BoardIcon
              d={['M6 9l6 6 6-6']}
              className={cn(
                'ms-auto h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-slate-400',
                open && 'rotate-180',
              )}
            />
          </button>
        )}
        {extra !== undefined && (
          <div className="ms-auto flex min-h-[2.125rem] min-w-0 items-center">{extra}</div>
        )}
        {filters !== undefined && open && (
          // ON the title's line (Round 26): the bar takes what the line has left. The vans' wide
          // bar wraps under the title only when that is less than its three boxes need; the left's
          // narrow bar NEVER wraps (R26 critic: a fixed basis sent it under the title again with a
          // three-figure count or the English words) — its two boxes shrink to share what is left.
          <div
            data-column-filters={filtersFit}
            className={cn(
              'flex min-w-0 flex-1',
              collapse !== undefined
                ? 'basis-full'
                : filtersFit === 'narrow'
                  ? 'basis-0'
                  : 'basis-[26rem]',
            )}
          >
            {filters}
          </div>
        )}
      </header>
      <div
        {...bodyProps}
        id={bodyId}
        hidden={!open}
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
  lead,
}: {
  figures: Pick<LoadFigures, 'egp' | 'usd' | 'othersSum'>;
  packages?: Packaging | null | undefined;
  /** A van's total says «0» rather than nothing — an empty van is a fact worth reading. */
  showZero?: boolean;
  /** First on the line, wrapping with the chips — the van's count of محصنات (Round 24c). */
  lead?: ReactNode;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const any = figures.egp !== 0 || figures.usd !== 0 || figures.othersSum !== 0;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {lead}
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
  /** Round 26 — the van's colour: its swatch before its name, as on its card. */
  accent?: VanAccent | null;
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
  compact = false,
}: {
  label: string;
  choices: readonly MoveChoice[];
  rowId: string;
  /** Round 25 — the chip's small icon button; the label is its tooltip and its accessible name. */
  compact?: boolean;
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
        {...(compact ? { 'aria-label': label, title: label } : {})}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-slate-700 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-slate-600 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-brand-500/15 dark:hover:text-brand-100',
          compact ? 'h-6 w-6 justify-center' : 'px-2 py-1',
        )}
      >
        <BoardIcon d={[...PATH.truck]} className="h-3.5 w-3.5" />
        {!compact && label}
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
                  {choice.accent !== undefined && choice.accent !== null && (
                    <VanSwatch accent={choice.accent} />
                  )}
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

/** «الاتجاه: …» / «الوقت المخطط: …» — what a header chip is, said on hover and to a screen reader. */
const chipTitle = (label: string, value: string): string => `${label}: ${value}`;

/**
 * A PERSON'S NAME on the van card, with the board's person card on it (Round 24c — «واحسن الاسماء
 * بتاعت القادة والاخصائيين»). The name is cut to its chip; the card, on hover or a keyboard focus,
 * says it whole. The card is «لوحة التشغيلة»'s own (`PlanMemberCardBody` — role, code, phone,
 * branch, attendance on the day, what he holds) once the day's crew directory has him: that list is
 * read under `operationsCrew.view` — the grant the specialists on this card already ride
 * (`crewPlanVisible`) — and only when a card first opens. Without the grant, or before the list
 * answers, the card says what the screen itself knows: the whole name, the code, where he sits.
 */
/**
 * A phone has no hover: a TAP on a card's trigger opens (or closes) it, a press anywhere else — or
 * Escape — closes it. The chip (Round 25), the van (Round 26) and — R26 critic — the captain's name
 * share this one rule. `pointer` is the last press's kind: only a touch toggles; a mouse's click is
 * the hover's business.
 */
const useTapCard = (
  anchor: RefObject<HTMLElement | null>,
): {
  tapped: boolean;
  setTapped: (next: boolean | ((open: boolean) => boolean)) => void;
  pointer: { current: string };
} => {
  const [tapped, setTapped] = useState(false);
  const pointer = useRef<string>('mouse');
  useEffect(() => {
    if (!tapped) return undefined;
    const away = (event: PointerEvent): void => {
      if (anchor.current?.contains(event.target as Node) === true) return;
      setTapped(false);
    };
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setTapped(false);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, [tapped, anchor]);
  return { tapped, setTapped, pointer };
};

const PersonName = ({
  person,
  seat,
  day,
  mayReadDirectory,
  className,
}: {
  person: OperationsDayBoardPersonDto;
  /** Where he sits, in words — «السيارة 104 · القائد». */
  seat: string;
  /** The day of the screen — the directory's day, for his attendance. */
  day: string;
  mayReadDirectory: boolean;
  className?: string;
}): JSX.Element => {
  const hover = useHoverCard(true);
  // R26 critic — on a phone, a tap on his name opens his card, as resting on it does on a computer.
  const { tapped, setTapped, pointer } = useTapCard(hover.anchor);
  return (
    <>
      <span
        data-van-person={person.employeeId}
        className={cn(
          'min-w-0 truncate rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
          className,
        )}
        {...hover.triggerProps}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
        }}
        onClick={() => {
          if (pointer.current !== 'touch') return;
          setTapped((open) => !open);
        }}
      >
        {personName(person)}
      </span>
      {(hover.open || tapped) && (
        <HoverCardLayer id={hover.id} anchor={hover.anchor} mark="crew-plan">
          <PersonCardBody
            person={person}
            seat={seat}
            day={day}
            mayReadDirectory={mayReadDirectory}
          />
        </HoverCardLayer>
      )}
    </>
  );
};

/** What the person card says — the board's card when the directory has him, else the screen's facts. */
const PersonCardBody = ({
  person,
  seat,
  day,
  mayReadDirectory,
}: {
  person: OperationsDayBoardPersonDto;
  seat: string;
  day: string;
  mayReadDirectory: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const directory = useOperationsCrewDirectory(day, mayReadDirectory);
  const member = directory.data?.members.find((one) => one.employeeId === person.employeeId);
  if (member !== undefined) {
    return (
      <PlanMemberCardBody
        member={member}
        mayReadCrew={can('operationsCrew.view')}
        seat={seat}
        attendance={<PlanAttendanceFact away={awayOf(member)} />}
      />
    );
  }
  return (
    <div data-distribution-person-card={person.employeeId}>
      <CardHead icon={<PersonIcon />}>{person.fullNameAr ?? <HoverCardMissing />}</CardHead>
      <dl className={HOVER_CARD_FACTS}>
        <HoverCardFact label={t('fleet.drivers.columns.employeeCode')}>
          {person.code === null ? <HoverCardMissing /> : <Figure>{person.code}</Figure>}
        </HoverCardFact>
        <HoverCardFact label={t('operations.crewPlan.card.seat')}>{seat}</HoverCardFact>
        {mayReadDirectory && directory.isPending && (
          <HoverCardFact label={t('operations.crewPlan.card.attendance')}>
            <HoverCardMissing loading />
          </HoverCardFact>
        )}
      </dl>
    </div>
  );
};

/**
 * THE COUNT OF محصنات on a van — «الصف نفسه بتاع القائد يكون قبله عدد المحصنات» (Round 25): a badge in
 * the محصنات's colour (Round 26 — indigo, its icon; a 0 grey), «4 محصنات», «11 محصنة» — the count's own
 * form (`pluralKey`), its figure in the face of the card's other figures (the code, the time), so
 * «0 محصنات» says zero. The same badge on the van's card.
 */
export const ShipmentsCount = ({
  count,
  ...rest
}: { count: number } & Record<`data-${string}`, string>): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <span
      {...rest}
      data-count-kind="shipments"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black ring-1 ring-inset',
        count > 0 ? SHIPMENTS_BADGE.some : SHIPMENTS_BADGE.zero,
      )}
    >
      <BoardIcon
        d={[...COUNT_LOOK.shipments.icon]}
        className={cn('h-3 w-3 shrink-0', COUNT_LOOK.shipments.mark, count === 0 && 'opacity-70')}
      />
      {t(pluralKey('operations.distribution.loadCount', locale, count), {
        count: countText(count, locale),
      })}
    </span>
  );
};

/**
 * ONE COUNT, in its own colour and icon (Round 26 — «والاعداد»): محصنات, كراتين, حقائب or صناديق, the
 * same chip on the van card, the van's card and a محصنة's card (`COUNT_LOOK`). A 0 is written, in
 * grey with its icon dimmer; so are «…» (still reading) and «—» (not to be read).
 */
export const CountChip = ({
  kind,
  value,
  children,
  className,
  ...rest
}: {
  kind: CountKind;
  /** The count — or «…» / «—» when there is none to write yet. */
  value: number | '…' | '—';
  /** The words after the figure — the kind's name. */
  children: ReactNode;
  className?: string;
} & Record<`data-${string}`, string>): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const some = typeof value === 'number' && value > 0;
  return (
    <span
      {...rest}
      data-count-kind={kind}
      data-count-zero={some ? undefined : 'true'}
      className={cn(
        'flex min-w-0 items-center justify-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-bold ring-1 ring-inset',
        some ? COUNT_LOOK[kind].chip : COUNT_ZERO,
        className,
      )}
    >
      <BoardIcon
        d={[...COUNT_LOOK[kind].icon]}
        className={cn('h-3 w-3 shrink-0', COUNT_LOOK[kind].mark, !some && 'opacity-70')}
      />
      {/* The figures' face, as the money and the code: a «0» reads as zero, where an Arabic zero
          reads as one more dot. */}
      <span
        dir="ltr"
        className={cn(NUM, 'text-[12px] font-black', some && COUNT_LOOK[kind].figure)}
      >
        {typeof value === 'number' ? countText(value, locale) : value}
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
};

/**
 * THE PACKAGES a van carries out — «اللى يظهر عدد الكراتين و الحقائب و الصناديق حتى لو ب 0 يتكتب»
 * (Round 25): the three kinds, in the owner's order, EACH ALWAYS, its count written even when 0 — the
 * vault's own counts (custody), summed over the load. `packages` null: the reader cannot read the
 * vault's counts — each says «—», with why on hover, rather than a 0 that would be a guess. The same
 * while the vault's read is out ('pending', «…») or has failed ('failed', «—»): a 0 is written only
 * once the counts are in (`vanPackages`). Round 26: each kind in its own colour (`CountChip`).
 */
export const PackageCounts = ({
  packages,
}: {
  packages: Packaging | null | 'pending' | 'failed';
}): JSX.Element => {
  const t = useT();
  const counted = typeof packages === 'object' && packages !== null ? packages : null;
  const why =
    packages === null
      ? t('operations.distribution.packagesUnknown')
      : packages === 'pending'
        ? t('operations.distribution.packagesPending')
        : packages === 'failed'
          ? t('operations.distribution.packagesFailed')
          : null;
  return (
    <div
      data-van-packages={
        counted !== null
          ? `${counted.cartons}/${counted.bags}/${counted.boxes}`
          : packages === null
            ? 'unknown'
            : packages
      }
      className="grid grid-cols-3 gap-1"
      {...(why === null ? {} : { title: why })}
      {...(packages === 'pending' ? { 'aria-busy': true } : {})}
    >
      {PACKAGE_KINDS.map((kind) => (
        <CountChip
          key={kind}
          kind={kind}
          data-van-package={kind}
          value={counted !== null ? counted[kind] : packages === 'pending' ? '…' : '—'}
        >
          {t(`operations.distribution.${kind}`)}
        </CountChip>
      ))}
    </div>
  );
};

/**
 * The van's swatch — its accent alone, beside its name on a card (the van's own, a محصنة's «على»).
 * The words beside it say which van; the swatch is never the only sign.
 */
export const VanSwatch = ({ accent }: { accent: VanAccent }): JSX.Element => (
  <span
    aria-hidden
    data-van-swatch={accent}
    className={cn(
      'inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/20',
      VAN_ACCENT_LOOK[accent].bar,
    )}
  />
);

/**
 * The van's code as the card draws it (Round 26): a pill in the van's own colour — solid, its words
 * in the colour that reads on it — with the van's drawing; «بدون سيارة (n)» for a crew without one.
 * Neutral where the van has no accent.
 */
export const VanCodePill = ({
  van,
  looseNumber,
  accent,
  size = 'md',
}: {
  van: OperationsDayBoardVehicleCrewDto;
  looseNumber: string | null;
  accent: VanAccent | null;
  size?: 'sm' | 'md';
}): JSX.Element => {
  const t = useT();
  const noVan = hasNoVan(van);
  return (
    <span
      dir={noVan ? undefined : 'ltr'}
      data-van-code={van.vehicleCode ?? ''}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 font-black',
        size === 'md' ? 'py-0.5 leading-6' : 'py-px leading-5',
        accent === null
          ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
          : VAN_ACCENT_LOOK[accent].pill,
      )}
    >
      <BoardIcon
        d={noVan ? [...PLAN_ICON.noVan] : [...PATH.truck]}
        className="h-3.5 w-3.5 shrink-0"
      />
      <span
        className={cn(
          noVan
            ? size === 'md'
              ? 'text-[13px]'
              : 'text-[12px]'
            : cn(size === 'md' ? 'text-[16px]' : 'text-[13px]', NUM),
        )}
      >
        {vanCodeText(t, van, looseNumber)}
      </span>
    </span>
  );
};

/** The van's planned time, in its own calm colour (Round 26 — `HEAD_PILL`); nothing when it has none. */
const TimePill = ({ van }: { van: OperationsDayBoardVehicleCrewDto }): JSX.Element | null => {
  const t = useT();
  const time = van.plannedTime === null || van.plannedTime === '' ? null : van.plannedTime;
  if (time === null) return null;
  return (
    <span
      data-van-time={time}
      title={chipTitle(t('operations.crew.plannedTime'), time)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset',
        HEAD_PILL.time,
      )}
    >
      <BoardIcon d={[...PLAN_ICON.clock]} className="h-3 w-3" />
      <span dir="ltr" className={NUM}>
        {time}
      </span>
    </span>
  );
};

/**
 * The van's direction, in its own calm colour (Round 26 — `HEAD_PILL`); «بلا اتجاه» in grey. On the
 * card's one line it is cut, whole on hover and to a screen reader; on the van's card (`wrap`) it is
 * written whole.
 */
const DirectionPill = ({
  van,
  wrap = false,
}: {
  van: OperationsDayBoardVehicleCrewDto;
  wrap?: boolean;
}): JSX.Element => {
  const t = useT();
  const direction =
    van.direction === null || van.direction.trim() === '' ? null : van.direction.trim();
  const directionText = direction ?? t('operations.distribution.noDirection');
  return (
    <span
      data-van-direction={van.direction ?? ''}
      title={chipTitle(t('operations.crew.direction'), directionText)}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] ring-1 ring-inset',
        direction === null
          ? cn('font-bold', HEAD_PILL.none)
          : cn('font-black', HEAD_PILL.direction),
      )}
    >
      <BoardIcon d={[...SHIPMENT_PATH.route]} className="h-3 w-3 shrink-0 rtl:-scale-x-100" />
      <span className="sr-only">{t('operations.crew.direction')}: </span>
      <span className={wrap ? 'min-w-0 break-words' : 'min-w-0 truncate'}>{directionText}</span>
    </span>
  );
};

/**
 * THE VAN'S CARD (Round 26) — «لما اقف على العربية يطلع كارت بقى بالقادة والاخصائيين اللى على العربيه
 * والسواقيين»: the van (its code in its colour, or «بدون سيارة (n)»), the time, the direction; then
 * everyone on it, slot by slot (`vanCrewGroups`) — القادة (every one, in the order put on the row, the
 * first marked as the one the card shows), «أخصائي 1», «أخصائي 2» (everyone in each) and السائقون (by
 * name, Fleet's duty row) — each slot saying «لا يوجد» when empty, or that the reader may not see it;
 * then what the van carries, in the counts' own colours.
 */
export const VanCrewCardBody = ({
  van,
  looseNumber,
  accent,
  crewPlanVisible,
  count,
  packages,
}: {
  van: OperationsDayBoardVehicleCrewDto & { securedType?: boolean; shiftTypeName?: string | null };
  looseNumber: string | null;
  accent: VanAccent | null;
  crewPlanVisible: boolean;
  count: number;
  packages: Packaging | null | 'pending' | 'failed';
}): JSX.Element => {
  const t = useT();
  const counted = typeof packages === 'object' && packages !== null ? packages : null;
  const label = {
    captains: t('operations.distribution.captains'),
    specialist1: t('operations.crew.slot.specialist1'),
    specialist2: t('operations.crew.slot.specialist2'),
    drivers: t('operations.board.card.drivers'),
  } as const;
  return (
    <div data-van-card={van.crewAssignmentId} data-van-card-accent={accent ?? undefined}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {accent !== null && <VanSwatch accent={accent} />}
        <VanCodePill van={van} looseNumber={looseNumber} accent={accent} size="sm" />
        <TimePill van={van} />
        {van.securedType === false && (
          <span className="min-w-0 truncate text-[11px] font-bold text-amber-800 dark:text-amber-200">
            {t('operations.distribution.notSecured')}
          </span>
        )}
      </div>
      <p className="mt-1.5 flex min-w-0">
        <DirectionPill van={van} wrap />
      </p>
      <dl className={HOVER_CARD_FACTS}>
        {vanCrewGroups(van, crewPlanVisible).map((group) => (
          <HoverCardFact key={group.slot} label={label[group.slot]}>
            {group.state === 'people' ? (
              <ul
                data-van-card-slot={group.slot}
                data-van-card-count={group.people.length}
                className="space-y-0.5"
              >
                {group.people.map((one) => (
                  <li
                    key={one.employeeId}
                    data-van-card-person={one.employeeId}
                    className="flex min-w-0 flex-wrap items-baseline gap-x-1.5"
                  >
                    {/* A person the directory cannot name is «…» — never a raw id. */}
                    <span className="min-w-0 break-words">{one.name ?? '…'}</span>
                    {one.code !== null && (
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <Figure>{one.code}</Figure>
                      </span>
                    )}
                    {one.shown && group.people.length > 1 && (
                      <span
                        data-van-card-shown="true"
                        className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 text-[10px] font-black leading-4 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                      >
                        <BoardIcon d={[...PLAN_ICON.rank]} className="h-2.5 w-2.5" width={2.4} />
                        {t('operations.distribution.vanCard.shown')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span
                data-van-card-slot={group.slot}
                data-van-card-state={group.state}
                className="font-semibold text-slate-500 dark:text-slate-400"
              >
                {group.state === 'hidden'
                  ? t('operations.distribution.vanCard.hidden')
                  : group.state === 'noVan'
                    ? t('operations.distribution.vanCard.noVan')
                    : t('operations.distribution.vanCard.none')}
              </span>
            )}
          </HoverCardFact>
        ))}
      </dl>
      {/* What it carries — the van card's own count badge, then the packages, each in its colour. */}
      <div
        data-van-card-counts="true"
        className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-700/60"
      >
        <ShipmentsCount count={count} data-van-card-count-of="shipments" />
        <div className="grid grid-cols-3 gap-1">
          {PACKAGE_KINDS.map((kind) => (
            <CountChip
              key={kind}
              kind={kind}
              data-van-card-count-of={kind}
              value={counted !== null ? counted[kind] : packages === 'pending' ? '…' : '—'}
            >
              {t(`operations.distribution.${kind}`)}
            </CountChip>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Round 26 — is a drag on anywhere on the page? Chromium sends no mouse events while one is, and the
 * van's card asks this as well before it opens (`vanHoverAllowed`): a card never floats over the vans
 * the hand is aiming at. Watched once, on the window, from the first van card drawn.
 */
let dragOn = false;
let dragsWatched = false;
const watchDrags = (): void => {
  if (dragsWatched || typeof window === 'undefined') return;
  dragsWatched = true;
  window.addEventListener('dragstart', () => (dragOn = true), true);
  window.addEventListener('dragend', () => (dragOn = false), true);
  window.addEventListener('drop', () => (dragOn = false), true);
  // A chip gone from the page mid-drag never delivers its `dragend`: a pointer moving with no
  // button held means the drag is over (the page's own rule for its drag).
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.buttons === 0) dragOn = false;
    },
    { passive: true },
  );
};

/** Is a «نقل إلى…» menu open on the page? (Round 25's F2 rule — no card over its vans.) */
const moveMenuOpen = (): boolean =>
  typeof document !== 'undefined' && document.querySelector('[data-move-menu]') !== null;

/** Is the pointer on a captain's own name — which opens his person card, not the van's? */
const onPersonName = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('[data-van-person]') !== null;

/**
 * THE VAN — the crew board's row for the day, as the owner asked it drawn on Round 25: «شكل العربية
 * بالمحصنات يتغير … العربيه لو عليها اتنين قادة انا عاوز اللى يظهر اللى انا ضيفته ف الاول الصف نفسه
 * بتاع القائد يكون قبله عدد المحصنات اللى على العربيه بعد كدا مش عاوز يظهر اخصائيين ولا اجمالى المصرى
 * ولا اجمالى الدولار ولا اجمالى العملات اللى يظهر عدد الكراتين و الحقائب و الصناديق حتى لو ب 0 يتكتب
 * وبرضو شكل المحصنة زى ما كانت على الشمال تفضل زى ما هى شكلها على العربية»:
 *   · THE HEAD stays one line (Round 24c): the code (or «بدون سيارة (n)»), the time, the direction;
 *   · THE CAPTAIN'S LINE: first the count of محصنات on the van (a badge, «٣ محصنات»), then the
 *     captain — the FIRST one put on the row (`captains[0]`, the board's stored order) when it has
 *     two; «بلا قائد» in red when it has none. No specialists, no money;
 *   · THE PACKAGES: «كراتين», «حقائب», «صناديق», each always, 0 written (`PackageCounts`);
 *   · THE LOAD: the محصنات on it as the same small chips as the left column (`ShipmentChip`).
 * A row of another type kept for what it carries (`securedType` false) says so under its head.
 *
 * Round 26 — «عاوزك تضيف الوان»: the van wears its ACCENT (`accent`, `lib/van-accent.ts`) — a stripe
 * at its start edge, its head on a band of it, its code in a pill of it — and every chip on it wears
 * the same; the counts wear their own colours. «لما اقف على العربية يطلع كارت بقى بالقادة والاخصائيين
 * اللى على العربيه والسواقيين»: resting on the head or the captain's line (not on a chip — a chip has
 * its card — and not on the captain's own name, which opens his) opens the van's card
 * (`VanCrewCardBody`) after the usual beat; a keyboard focus opens it at once, a tap on a phone too.
 * Never while a drag is on or a «نقل إلى…» menu is open (`vanHoverAllowed`).
 *
 * THE WHOLE CARD IS A DROP TARGET (`data-drop-van`): the page's frame takes the drag and reads the
 * mark under the pointer at the drop — the head, the captain's line, the packages, the empty load and
 * a chip on it all mean this van (`lib/distribution-drag.ts`). The van's card is a layer that takes
 * no pointer, so it never stands between the hand and the drop.
 */
export const VanCard = ({
  van,
  looseNumber = null,
  crewPlanVisible,
  day,
  count,
  packages,
  accent = null,
  actions,
  drop,
  children,
  footer,
}: {
  van: OperationsDayBoardVehicleCrewDto & { securedType?: boolean; shiftTypeName?: string | null };
  /** A crew without a van: its number among the day's («بدون سيارة (n)»), as the page writes it. */
  looseNumber?: string | null;
  /** The crew plan's grant — the captain's card reads the day's crew directory under it. */
  crewPlanVisible: boolean;
  /** The screen's day, 'YYYY-MM-DD' — the person card reads the crew directory of that day. */
  day: string;
  /** How many محصنات are on it now (the draft's). */
  count: number;
  /** The vault's counts over its load; null when the reader cannot read them, 'pending' or
   *  'failed' while the vault's read is out or has failed (`vanPackages`). */
  packages: Packaging | null | 'pending' | 'failed';
  /** Round 26 — the van's colour (`vanAccents`); null draws it neutral. */
  accent?: VanAccent | null;
  /** Above the van — the vault's «تسليم» and «طباعة». */
  actions?: ReactNode;
  drop?: {
    /** A shipment is being dragged and this van would take it. */
    armed: boolean;
    /** It is under the pointer: `place` — it lands here; `refuse` — this van says no. */
    over: 'place' | 'refuse' | null;
  };
  children: ReactNode;
  /** Under the load — the vault's «not in the vault yet» note. */
  footer?: ReactNode;
}): JSX.Element => {
  const t = useT();
  const captain = van.captains[0] ?? null;
  const noVan = hasNoVan(van);
  const name = vanPhrase(t, van, looseNumber);
  const kept = van.securedType === false;
  const typeName = van.shiftTypeName ?? null;
  const look = accent === null ? null : VAN_ACCENT_LOOK[accent];

  // The van's card — on the head and the captain's line (Round 26).
  useEffect(watchDrags, []);
  const hover = useHoverCard(true, {
    when: () => vanHoverAllowed({ dragging: dragOn, menuOpen: moveMenuOpen(), onPerson: false }),
  });
  const { tapped, setTapped, pointer } = useTapCard(hover.anchor);
  // The pointer moved inside the head or the captain's line: onto the captain's own name, his card
  // takes over; anywhere else, the van's card waits its beat (again, if the name had it).
  const rest = (target: EventTarget | null): void => {
    if (onPersonName(target)) hover.dismiss();
    else hover.arm();
  };

  return (
    <article
      data-distribution-van={van.crewAssignmentId}
      data-drop-van={van.crewAssignmentId}
      data-no-van={noVan ? 'true' : undefined}
      data-not-secured={kept ? 'true' : undefined}
      data-van-accent={accent ?? undefined}
      data-drop-over={drop?.over ?? undefined}
      data-drop-armed={drop?.armed === true ? 'true' : undefined}
      aria-label={name}
      className={cn(
        // `relative`: the head's screen-reader words (`sr-only`, absolute) and the accent's stripe
        // stay inside the card; `overflow-hidden` cuts the stripe to the card's round corners.
        'relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border bg-white p-2.5 shadow-sm transition-[box-shadow,border-color,background-color] dark:bg-[#111827]',
        look !== null && 'ps-3.5',
        kept
          ? 'border-dashed border-amber-400 dark:border-amber-500/60'
          : 'border-slate-200 dark:border-[#24305a]',
        drop?.armed === true &&
          drop.over === null &&
          'border-dashed border-brand-300 dark:border-brand-500/50',
        drop?.over === 'place' &&
          'border-brand-500 bg-brand-50 shadow-lg shadow-brand-500/20 ring-2 ring-brand-500 dark:border-brand-400 dark:bg-brand-500/10 dark:ring-brand-400',
        drop?.over === 'refuse' &&
          'border-rose-500 bg-rose-50 ring-2 ring-rose-500 dark:border-rose-400 dark:bg-rose-500/10 dark:ring-rose-400',
        (captain === null || kept) && 'opacity-90',
      )}
    >
      {look !== null && (
        // The van's colour at its start edge — the palette's own dot (`SHIFT_TYPE_TONE`).
        <span
          aria-hidden
          data-van-stripe={accent ?? ''}
          className={cn('pointer-events-none absolute inset-y-0 start-0 w-[5px]', look.bar)}
        />
      )}
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2 dark:border-slate-800">
          {actions}
        </div>
      )}
      {/* The head and the captain's line: resting on them opens the van's card. */}
      <div
        {...hover.triggerProps}
        data-van-hover={van.crewAssignmentId}
        role="group"
        aria-label={t('operations.distribution.vanCard.label', { van: name })}
        onMouseEnter={(event) => rest(event.target)}
        onMouseOver={(event) => rest(event.target)}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
        }}
        onClick={(event) => {
          // R26 critic — a tap on the captain's name is his card's: the van's closes, if open.
          const onPerson = onPersonName(event.target);
          if (onPerson) setTapped(false);
          if (!vanTapAllowed({ touch: pointer.current === 'touch', onPerson })) return;
          setTapped((open) => !open);
        }}
        className="flex min-w-0 flex-col gap-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
      >
        <header
          data-van-band={accent ?? 'none'}
          className={cn(
            'flex min-w-0 items-center rounded-lg px-1.5 py-1',
            look?.band ?? 'bg-slate-100/80 dark:bg-white/[0.04]',
          )}
        >
          {/* ONE line: code · time · direction — nothing else, so the direction has the room. */}
          <div data-van-head="true" className="flex min-w-0 flex-1 items-center gap-1.5">
            <VanCodePill van={van} looseNumber={looseNumber} accent={accent} />
            <TimePill van={van} />
            <DirectionPill van={van} />
          </div>
        </header>
        {kept && (
          // Round 25 — a row of another type, listed only for what it already carries.
          <p
            data-van-not-secured={typeName ?? ''}
            title={
              typeName === null
                ? t('operations.distribution.notSecuredHintNoType')
                : t('operations.distribution.notSecuredHint', { type: typeName })
            }
            className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold leading-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
          >
            <BoardIcon d={[...PATH.warn]} className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              {t('operations.distribution.notSecured')}
              {typeName !== null && (
                <span className="font-semibold">
                  {' '}
                  · {t('operations.distribution.typeIs', { type: typeName })}
                </span>
              )}
            </span>
          </p>
        )}
        {/* THE CAPTAIN'S LINE: the count first, then the first captain. */}
        <div
          data-van-captain-line={van.crewAssignmentId}
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 ring-1 ring-inset',
            captain === null ? CAPTAIN_BAND.none : CAPTAIN_BAND.some,
          )}
        >
          <ShipmentsCount count={count} data-van-count={String(count)} />
          {captain === null ? (
            <span
              data-van-captain="none"
              className="flex min-w-0 items-center gap-1 text-[12px] font-bold leading-5 text-rose-700 dark:text-rose-300"
            >
              <BoardIcon d={[...PATH.warn]} className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{t('operations.distribution.noCaptain')}</span>
            </span>
          ) : (
            <span
              data-van-captain={captain.employeeId}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                data-captain-mark="true"
                className={cn(
                  'inline-flex shrink-0 items-center gap-0.5 rounded-full py-0.5 pe-2 ps-1.5 text-[10px] font-black leading-4',
                  CAPTAIN_MARK,
                )}
              >
                <BoardIcon d={[...PLAN_ICON.rank]} className="h-3 w-3" width={2.4} />
                {t('operations.crewPlan.role.captain')}
              </span>
              <PersonName
                person={captain}
                seat={`${name} · ${t('operations.crew.slot.captain')}`}
                day={day}
                mayReadDirectory={crewPlanVisible}
                className="text-[13px] font-black leading-5 text-slate-900 dark:text-white"
              />
            </span>
          )}
        </div>
      </div>
      <PackageCounts packages={packages} />
      <div
        data-van-load={van.crewAssignmentId}
        className={cn(
          'flex min-h-[3rem] flex-col gap-1.5 rounded-lg border border-dashed p-1.5 transition-colors',
          'border-slate-200 dark:border-slate-700/70',
          drop?.over === 'place' && 'border-brand-400 dark:border-brand-400/70',
        )}
      >
        {children}
      </div>
      {footer}
      {(hover.open || tapped) && (
        <HoverCardLayer id={hover.id} anchor={hover.anchor} mark="secured-van">
          <VanCrewCardBody
            van={van}
            looseNumber={looseNumber}
            accent={accent}
            crewPlanVisible={crewPlanVisible}
            count={count}
            packages={packages}
          />
        </HoverCardLayer>
      )}
    </article>
  );
};

/** A load's empty place — what to do with it, said where the shipments would be. */
export const EmptyLoad = ({ children }: { children: ReactNode }): JSX.Element => (
  <p className="flex flex-1 items-center justify-center px-2 py-3 text-center text-xs font-bold text-slate-400 dark:text-slate-500">
    {children}
  </p>
);

/** One amount of a محصنة, as its card lists it — the currency by name, the figure. */
export interface ChipMoneyLine {
  key: string;
  label: string;
  amount: number;
}

/**
 * What a محصنة's card says — «ولما اعمل هوفر عليها يجيب بقى معلومتها» (Round 25): everything the chip
 * no longer prints. The bank and its stage; from → to; the area; the delivery day (an overdue one
 * says so); each amount by currency; the packages the vault counted (or that it holds none of it
 * yet); the vault's receipt number; the van and captain it is on; and what the screen has to say
 * about it in words (proposed, unsaved, started, refused, re-dated by the save, not in the vault).
 * The read carries no seals: the receipt keeps them, and they are not repeated here.
 */
export const ShipmentCardBody = ({
  row,
  bankName,
  money,
  packages,
  packagesRead,
  place,
  placeAccent = null,
  notes,
}: {
  row: OperationsSecuredDistributionRowDto;
  bankName: string;
  money: readonly ChipMoneyLine[];
  packages: Packaging | undefined;
  /** The vault's packaging read (`packagingRead`): 'forbidden' — the reader cannot read the vault's
   *  counts, the line is left out; 'pending' / 'failed' — the line says so, never «not in the
   *  vault»; 'ready' — `packages` undefined means the vault holds none of it. */
  packagesRead: PackagingRead;
  /** «السيارة 104 · مع …», or null on no van. */
  place: string | null;
  /** Round 26 — the colour of the van it is on: a swatch beside «على» (null: on no van). */
  placeAccent?: VanAccent | null;
  notes: readonly { key: string; text: string; tone: 'info' | 'warn' | 'danger' }[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div data-secured-card={row.id} data-card-van-accent={placeAccent ?? undefined}>
      <CardHead
        icon={<BoardIcon d={[...SHIPMENT_PATH.bank]} className="h-3.5 w-3.5" />}
        sub={row.securedStage === null ? undefined : <SecuredStageBadge stage={row.securedStage} />}
      >
        {bankName === '' ? <HoverCardMissing /> : bankName}
      </CardHead>
      <dl className={HOVER_CARD_FACTS}>
        <HoverCardFact label={t('operations.distribution.card.from')}>
          {row.origin === null ? (
            <HoverCardMissing />
          ) : (
            <>
              {row.origin.name}
              <span className="font-semibold text-slate-500 dark:text-slate-400">
                {' '}
                · {row.origin.bankName}
              </span>
            </>
          )}
        </HoverCardFact>
        <HoverCardFact label={t('operations.distribution.card.to')}>
          {row.destination === null ? (
            <HoverCardMissing />
          ) : (
            <>
              {row.destination.name}
              <span className="font-semibold text-slate-500 dark:text-slate-400">
                {' '}
                · {row.destination.bankName}
              </span>
            </>
          )}
        </HoverCardFact>
        <HoverCardFact label={t('operations.shipment.area')}>
          {row.areaName ?? t('operations.distribution.noArea')}
        </HoverCardFact>
        <HoverCardFact label={t('operations.distribution.card.deliveryDay')}>
          {dayText(row.deliveryDate)}
          {row.overdue && (
            <span className="font-black text-rose-600 dark:text-rose-400">
              {' '}
              · {t('operations.distribution.overdue')}
            </span>
          )}
        </HoverCardFact>
        <HoverCardFact label={t('operations.distribution.card.amounts')}>
          {money.length === 0 ? (
            <HoverCardMissing />
          ) : (
            <span className="flex flex-col">
              {money.map((line) => (
                <span key={line.key} data-card-money={line.key}>
                  <span dir="ltr" className={cn(NUM, 'font-black')}>
                    {formatAmount(line.amount, locale)}
                  </span>{' '}
                  {line.label}
                </span>
              ))}
            </span>
          )}
        </HoverCardFact>
        {packagesRead !== 'forbidden' && (
          <HoverCardFact label={t('operations.distribution.card.packages')}>
            {packagesRead !== 'ready' ? (
              <span
                data-card-packages={packagesRead}
                className="text-slate-500 dark:text-slate-400"
              >
                {t(
                  packagesRead === 'pending'
                    ? 'operations.distribution.packagesPending'
                    : 'operations.distribution.packagesFailed',
                )}
              </span>
            ) : packages === undefined ? (
              <span className="text-slate-500 dark:text-slate-400">
                {t('operations.distribution.card.notCounted')}
              </span>
            ) : (
              // Round 26 — each kind in its own colour, as on the van.
              <span
                data-card-packages={`${packages.cartons}/${packages.bags}/${packages.boxes}`}
                className="flex flex-wrap gap-1"
              >
                {PACKAGE_KINDS.map((kind) => (
                  <CountChip key={kind} kind={kind} value={packages[kind]}>
                    {t(`operations.distribution.${kind}`)}
                  </CountChip>
                ))}
              </span>
            )}
          </HoverCardFact>
        )}
        {row.vaultReceiptNumber !== null && row.vaultReceiptNumber !== '' && (
          <HoverCardFact label={t('operations.distribution.card.receipt')}>
            <Figure>{row.vaultReceiptNumber}</Figure>
          </HoverCardFact>
        )}
        <HoverCardFact label={t('operations.distribution.card.on')}>
          {place === null ? (
            t('operations.distribution.unplaced')
          ) : (
            // Round 26 — the van's swatch beside its name: the chip's colour, said in words too.
            <span className="inline-flex min-w-0 items-baseline gap-1.5">
              {placeAccent !== null && (
                <span className="translate-y-px self-center">
                  <VanSwatch accent={placeAccent} />
                </span>
              )}
              <span className="min-w-0">{place}</span>
            </span>
          )}
        </HoverCardFact>
      </dl>
      {notes.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[12px] font-bold leading-5 dark:border-slate-700/60">
          {notes.map((note) => (
            <li
              key={note.key}
              data-card-note={note.key}
              className={cn(
                note.tone === 'danger'
                  ? 'text-rose-700 dark:text-rose-300'
                  : note.tone === 'warn'
                    ? 'text-amber-800 dark:text-amber-200'
                    : 'text-slate-600 dark:text-slate-300',
              )}
            >
              {note.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** A chip's small mark — an icon with its words on hover and for a screen reader. */
export const ChipMark = ({
  tone,
  icon,
  label,
  ...rest
}: {
  tone:
    'proposed' | 'moved' | 'overdue' | 'started' | 'refused' | 'reschedule' | 'waiting' | 'captain';
  icon: readonly string[];
  label: string;
} & Record<`data-${string}`, string>): JSX.Element => (
  <span
    {...rest}
    title={label}
    className={cn(
      'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
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
        reschedule:
          'bg-violet-100 text-violet-700 ring-violet-300 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-400/40',
        waiting:
          'bg-slate-100 text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/60',
        captain:
          'bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/40',
      }[tone],
    )}
  >
    <BoardIcon d={[...icon]} className="h-3 w-3" />
    <span className="sr-only">{label}</span>
  </span>
);

/**
 * THE محصنة, SMALL — «عاوز المحصنة تظهر صغيره عبارة عن البنك والفرع ولما اعمل هوفر عليها يجيب بقى
 * معلومتها» (Round 25), the same chip on the left and on a van («وبرضو شكل المحصنة زى ما كانت على
 * الشمال تفضل زى ما هى شكلها على العربية»): the drag handle, the stage's mark, the bank · the branch it
 * goes to, the screen's marks as small icons, and «نقل إلى…» as a small icon (`move`). Everything
 * else is on its card (`card`), opened by a hover, a keyboard focus, or a tap on a phone.
 *
 * `drag` makes the whole chip draggable; its `dragstart` writes the drag and nothing else (the page's
 * `startDrag`, `lib/distribution-drag.ts`).
 */
/**
 * Is a pointer coming onto the chip a hover on the chip itself (Round 25 critic)? Its «نقل إلى…» menu
 * is drawn in a portal, yet React counts the menu inside the chip, so a pointer coming into the
 * menu from outside fired the chip's mouseenter — and 300ms later the chip's card opened OVER the
 * menu's vans. Not a hover on the chip: a pointer whose target is outside the chip's own box (the
 * menu), or any pointer while the chip's menu is open (its button says `aria-expanded="true"`).
 */
export const hoverIsOnChip = (
  chip: Pick<Element, 'contains' | 'querySelector'>,
  target: EventTarget | null,
): boolean =>
  chip.contains(target as Node | null) &&
  chip.querySelector('[data-move-open][aria-expanded="true"]') === null;

export const ShipmentChip = ({
  row,
  bankName,
  branchName,
  marks,
  move,
  drag,
  tone,
  accent = null,
  card,
}: {
  row: OperationsSecuredDistributionRowDto;
  bankName: string;
  branchName: string;
  marks?: ReactNode;
  move?: ReactNode;
  drag?: {
    dragging: boolean;
    onDragStart: (event: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  /** The chip's edge: a proposal (amber, dashed), an unsaved move (brand), a refusal (rose). */
  tone?: 'proposed' | 'moved' | 'refused' | undefined;
  /**
   * Round 26 — the colour of the van it is on (null on the left: neutral). Its stripe at the chip's
   * start and a thin ground of it — but a proposal and an unsaved move keep their own ground and
   * edge (R26 critic): the van's colour is then the stripe alone.
   */
  accent?: VanAccent | null;
  /** What its card says (`ShipmentCardBody`). */
  card: ReactNode;
}): JSX.Element => {
  const hover = useHoverCard(true);
  // A phone has no hover: a TAP on the chip (not on its «نقل إلى…») opens the card, a tap anywhere
  // else closes it (`useTapCard`).
  const { tapped, setTapped, pointer } = useTapCard(hover.anchor);
  const { onDragStart: closeOnDrag, onMouseEnter: hoverIn, ...trigger } = hover.triggerProps;
  return (
    <>
      <div
        {...trigger}
        onMouseEnter={(event) => {
          if (!hoverIsOnChip(event.currentTarget, event.target)) return;
          hoverIn?.();
        }}
        data-distribution-shipment={row.id}
        data-shipment-tone={tone ?? 'saved'}
        data-chip-accent={accent ?? undefined}
        aria-label={`${bankName === '' ? '…' : bankName} · ${branchName === '' ? '…' : branchName}`}
        draggable={drag !== undefined}
        onDragStart={(event) => {
          closeOnDrag?.();
          setTapped(false);
          drag?.onDragStart(event);
        }}
        onDragEnd={drag?.onDragEnd}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
        }}
        onClick={(event) => {
          if (pointer.current !== 'touch') return;
          if ((event.target as Element).closest('button') !== null) return;
          setTapped((open) => !open);
        }}
        className={cn(
          'group relative flex min-h-[2rem] min-w-0 items-center gap-1 overflow-hidden rounded-lg border py-0.5 pe-0.5 text-start shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
          'border-slate-200 dark:border-[#2b3b6b]',
          // ONE ground. R26 critic: a proposal and an unsaved move keep their OWN ground on a van
          // too (the van's colour is then its stripe alone) — on an orange van, a proposal's amber
          // was gone but for its dashed edge. Else the van's colour, thin; else plain.
          accent !== null ? 'ps-2' : 'ps-1',
          tone === 'proposed'
            ? 'bg-amber-50 dark:bg-amber-400/[0.06]'
            : tone === 'moved'
              ? 'bg-brand-50/60 dark:bg-brand-500/[0.08]'
              : accent !== null
                ? VAN_ACCENT_LOOK[accent].chip
                : 'bg-white dark:bg-[#0f1a3a]',
          tone === 'proposed' && 'border-dashed border-amber-500 dark:border-amber-400/60',
          tone === 'moved' && 'border-brand-400 dark:border-brand-400/60',
          tone === 'refused' &&
            'border-rose-500 ring-1 ring-rose-500 dark:border-rose-400 dark:ring-rose-400',
          drag !== undefined && 'cursor-grab active:cursor-grabbing',
          drag?.dragging === true && 'opacity-40',
        )}
      >
        {accent !== null && (
          // The van's colour at the chip's start — the palette's own dot, as the van's stripe.
          <span
            aria-hidden
            data-chip-stripe={accent}
            className={cn(
              'pointer-events-none absolute inset-y-0 start-0 w-[3px]',
              VAN_ACCENT_LOOK[accent].bar,
            )}
          />
        )}
        {drag !== undefined && (
          <span aria-hidden className="shrink-0 text-slate-300 dark:text-slate-600">
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
        {row.securedStage !== null && <SecuredStageMark stage={row.securedStage} />}
        <span data-chip-text="true" className="min-w-0 flex-1 truncate text-[12.5px] leading-5">
          <span className="font-black text-slate-900 dark:text-white">
            {bankName === '' ? '…' : bankName}
          </span>
          <span aria-hidden className="text-slate-400 dark:text-slate-500">
            {' '}
            ·{' '}
          </span>
          <span data-chip-branch="true" className="font-bold text-slate-600 dark:text-slate-300">
            {branchName === '' ? '…' : branchName}
          </span>
        </span>
        {marks}
        {move}
      </div>
      {(hover.open || tapped) && (
        <HoverCardLayer id={hover.id} anchor={hover.anchor} mark="secured-shipment">
          {card}
        </HoverCardLayer>
      )}
    </>
  );
};

/** A magnifying glass — the search boxes' icon. */
const SEARCH_ICON = ['M21 21l-4.35-4.35', 'M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z'];

/**
 * A column's filter bar (Round 25) — «احط فلتر فوق»: its boxes in the boards' filter colours, and
 * «مسح التصفية» with what the filter leaves («المعروض ٣ من ١٢») once one is set.
 *
 * Round 26 — the bar sits ON the column's head line, beside the title (`DistributionColumn`). Its
 * boxes share that line; `narrow` (the left column's quarter) keeps them compact, and the words of a
 * filter in use take a line of their own under them there — beside them on the vans' wide head.
 */
export const ColumnFilterBar = ({
  children,
  active,
  shown,
  total,
  onClear,
  narrow = false,
  ...rest
}: {
  children: ReactNode;
  active: boolean;
  shown: number;
  total: number;
  onClear: () => void;
  /** The left column's quarter: compact boxes on one row; «المعروض … · مسح التصفية» under them. */
  narrow?: boolean;
} & Record<`data-${string}`, string>): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div
      {...rest}
      role="search"
      className={cn(
        'flex min-w-0 flex-1 flex-wrap items-center gap-1.5',
        '[&_input]:!border-slate-300 dark:[&_input]:!border-slate-700/80 [&_input]:!bg-white dark:[&_input]:!bg-[#080C14] [&_input]:!text-slate-900 dark:[&_input]:!text-slate-100',
        '[&_select]:!border-slate-300 dark:[&_select]:!border-slate-700/80 [&_select]:!bg-white dark:[&_select]:!bg-[#080C14] [&_select]:!text-slate-900 dark:[&_select]:!text-slate-100',
      )}
    >
      {narrow ? (
        // R26 critic — the left's two boxes on ONE row, whatever room the title leaves them: they
        // shrink together rather than stack (the bar beside the title never wraps under it).
        <div
          data-filter-boxes="true"
          className="flex w-full min-w-0 flex-nowrap items-center gap-1.5"
        >
          {children}
        </div>
      ) : (
        children
      )}
      {active && (
        <span
          data-filter-active={narrow ? 'narrow' : 'wide'}
          className={cn(
            // Narrow (the left's quarter): as wide as its two boxes — «مسح التصفية» wraps under
            // «المعروض …» rather than run past the column's edge (1024–1280); R26 critic: and each
            // may break onto a second line of its own when even alone it is wider than the bar
            // (three-figure counts, the English words).
            narrow
              ? 'flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5'
              : 'flex min-w-0 items-center gap-2 ms-auto shrink-0',
          )}
        >
          <span
            data-filter-shown={`${shown}/${total}`}
            className={cn(
              narrow ? 'min-w-0 break-words' : 'whitespace-nowrap',
              'text-[11px] font-bold text-slate-500 dark:text-slate-400',
            )}
          >
            {t('operations.distribution.filter.shown', {
              shown: countText(shown, locale),
              total: countText(total, locale),
            })}
          </span>
          <button
            type="button"
            data-filter-clear="true"
            onClick={onClear}
            className={cn(
              narrow
                ? 'inline-flex min-w-0 items-start gap-1 rounded-md px-1.5 py-0.5 text-start'
                : 'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5',
              'text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:text-brand-300',
            )}
          >
            <BoardIcon
              d={['M6 18L18 6M6 6l12 12']}
              className={cn('h-3 w-3 shrink-0', narrow && 'mt-0.5')}
            />
            <span className="min-w-0">{t('operations.distribution.filter.clear')}</span>
          </button>
        </span>
      )}
    </div>
  );
};

/**
 * A typed filter — its icon at the start, the label for a screen reader and on hover. Round 26:
 * `placeholder` — shorter words in the box itself where the head's line is narrow (the label stays
 * its name); `fit` — how wide it may grow beside the title.
 */
export const FilterTextBox = ({
  label,
  value,
  onChange,
  icon = SEARCH_ICON,
  ltr = false,
  placeholder,
  fit = 'wide',
  className,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: readonly string[];
  /** A code: typed left to right. */
  ltr?: boolean;
  /** The words in the empty box — the label when left out. */
  placeholder?: string;
  /** `narrow` — the left column's compact box; `code` — a code, short; `wide` — a name. */
  fit?: 'wide' | 'code' | 'narrow';
  className?: string;
} & Record<`data-${string}`, string>): JSX.Element => (
  <FilterWithIcon
    icon={icon}
    className={cn(
      'min-w-0 flex-1',
      fit === 'narrow'
        ? 'basis-[3.5rem]'
        : fit === 'code'
          ? 'basis-[7.5rem] lg:max-w-[11rem]'
          : 'basis-[9rem] lg:max-w-[17rem]',
      className,
    )}
  >
    <Input
      {...rest}
      type="search"
      density="tight"
      dir={ltr ? 'ltr' : undefined}
      aria-label={label}
      title={label}
      placeholder={placeholder ?? label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        '!py-1.5 placeholder:text-slate-500 dark:placeholder:text-slate-400',
        // R26 critic — the left's narrow box beside a three-figure count: its words get the room
        // of the browser's own «×» (the bar's «مسح التصفية» clears it) and of the end padding.
        fit === 'narrow'
          ? '!pe-1.5 !text-[12px] [&::-webkit-search-cancel-button]:hidden'
          : 'text-[13px]',
        ltr && '[[dir=rtl]_&]:text-right',
      )}
    />
  </FilterWithIcon>
);

/**
 * The area filter — the areas present, «كل المناطق» first; a native list: a phone opens its own.
 * Round 26 — `fit` as `FilterTextBox`'s; in the narrow head the list keeps every word, and the box
 * cuts what it shows with an ellipsis (its label is its name, and its tooltip says the area chosen).
 */
export const FilterAreaSelect = ({
  label,
  allLabel,
  value,
  options,
  onChange,
  fit = 'wide',
  className,
  ...rest
}: {
  label: string;
  allLabel: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  fit?: 'wide' | 'narrow';
  className?: string;
} & Record<`data-${string}`, string>): JSX.Element => {
  const chosen = options.find((option) => option.value === value)?.label ?? allLabel;
  return (
    <div
      className={cn(
        'relative min-w-0 flex-1',
        fit === 'narrow' ? 'basis-[5.5rem]' : 'basis-[8rem] lg:max-w-[14rem]',
        className,
      )}
    >
      <Select
        {...rest}
        density="tight"
        aria-label={label}
        title={value === '' ? label : `${label}: ${chosen}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          '!py-1.5 ps-6 [text-overflow:ellipsis]',
          fit === 'narrow' ? '!text-[12px]' : 'text-[13px]',
        )}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <span className="pointer-events-none absolute start-0 top-0 z-[1] flex h-full items-center ps-2">
        <BoardIcon
          d={[...FILTER_ICON.map]}
          className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400"
        />
      </span>
    </div>
  );
};

/** The delivery day a card names (an overdue one's), year first inside Arabic. */
export const dayText = (iso: string | null): string =>
  iso === null ? '—' : ltrIsolate(iso.slice(0, 10));
