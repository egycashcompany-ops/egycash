// The frame «لوحة التشغيلة» and «الطاقم الثابت» share — Round 27: «عاوزك تخلى شاشة الطاقم الثابت نفس
// شكل لوحة التشغيل بقى فاهم».
//
// One look, so one source: the table's and the bar's looks, a count chip, the page's grid (the table
// at the start, the two pools at the end — on the left in Arabic), the toolbar's start (what the hand
// holds, beside the totals — Round 34 E on the board, Round 34 G on «الطاقم الثابت»), the «المعروض N
// من M» pair, the marks that say a screen is read only, the pools' «إخراج …» button, and the DOM half
// of the drop (`targetAt`). Both pages import them; neither redraws them.
//
// The slot itself is `CrewPlanSlot`; the chips, the pools and the lists are the board's components,
// told which screen they are on by `crew-plan-scope`.
import { useId, type ReactNode } from 'react';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { CloseIcon } from '../../../shared/ui/icons';
import { useAppSelector } from '../../../store';
import { BOARD_TABLE_FILL } from '../../fleet/components/board-scroll';
import {
  HOVER_CARD_ICON,
  HoverCardLayer,
  useHoverCard,
} from '../../fleet/components/HoverCardLayer';
import { BoardIcon, PATH } from '../../fleet/components/FuelCardBoard';
import { targetFromMarks, type DropTarget } from '../lib/crew-drag';
import { DAY_BAR } from './SecuredDistributionParts';
import { BOARD_TABLE_LOOK } from './ShipmentsBoard';
import { SHIPMENT_PATH } from './shipment-icons';
import { scopedKey, useCrewPlanScope } from './crew-plan-scope';

/**
 * The boards' table, fitted to a row of controls:
 *   · the boards size every button in a cell as a 28px icon square (`DARK_TABLE`); the chips and the
 *     cell's own controls (`data-cell-control`) take their own size instead — the attribute outranks
 *     the boards' rule;
 *   · the cells' sides 4px rather than 9: a row of controls beside the pools on a laptop.
 * The board adds its own box rule (the type) and the halo of a coloured row (`PLAN_TABLE`).
 */
export const CREW_PLAN_TABLE = cn(
  BOARD_TABLE_LOOK,
  BOARD_TABLE_FILL,
  '[&_td_button[data-cell-control]]:!h-auto [&_td_button[data-cell-control]]:!w-auto',
);

/** The cells' sides and tops — after any rule of the page's own, as the board orders them. */
export const CREW_PLAN_CELLS =
  '[&_tbody_td]:!px-1 [&_thead_th]:!px-1.5 [&_tbody_td]:!py-1.5 [&_tbody_td]:align-top';

/** The bar's lists in the boards' colours (`DARK_FILTER_BAR`'s), on the day's bar. */
export const CREW_PLAN_BAR = cn(
  DAY_BAR,
  '[&_button[aria-haspopup]]:!border-slate-300 dark:[&_button[aria-haspopup]]:!border-slate-700/80 [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#080C14] [&_button[aria-haspopup]]:!text-slate-800 dark:[&_button[aria-haspopup]]:!text-slate-200',
  '[&_[role=listbox]]:!border-slate-300 dark:[&_[role=listbox]]:!border-slate-700 [&_[role=listbox]]:!bg-white dark:[&_[role=listbox]]:!bg-[#111827]',
);

/**
 * Round 34 E — the bar on ONE line from 1280 (8px between its boxes): the filters and — at its end,
 * when they narrow — «المعروض N من M». The totals left it for the toolbar. Round 34 G — «الطاقم
 * الثابت»'s bar too: its counters went up the same way.
 */
export const CREW_PLAN_BAR_LINE = cn(
  CREW_PLAN_BAR,
  'min-[1280px]:flex-nowrap min-[1280px]:gap-x-2',
);

/**
 * A count chip — a button that filters the table to what it counts. A hair tighter below 1440: there
 * the board's twelve chips were 50px short of one line, and the second line they wrapped onto came off
 * a 768px-high laptop's table and pools. Since Round 34 G only «المعروض N من M» wears it: both pages'
 * totals are the toolbar's compact chips (`HEAD_CHIP`).
 */
export const COUNT_CHIP =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-1 py-1 text-[11.5px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 min-[1440px]:px-1.5';

/**
 * Round 34 E — the totals in the board's toolbar, where the legend and the hint were (Round 34 G —
 * «الطاقم الثابت»'s counters too). The owner:
 * «واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات». ONE line, never wrapped, the acts' height: the
 * chips compact (`HEAD_CHIP`), and when the catalog outgrows the room the line scrolls sideways inside
 * its own box — no scrollbar to take a height of its own; the edge that hides chips fades and a plain
 * wheel moves it (`lib/side-scroll.ts`), a trackpad or a finger as ever, and a chip reached by Tab is
 * brought clear of the edge and its fade (`followSide`'s focus — the browser alone leaves a partly
 * seen chip under the fade). Every chip takes the focus, «صيانة» too, so Tab carries the line to its end.
 */
export const HEAD_STRIP =
  'flex h-[34px] w-full min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * A chip of the toolbar's totals — `COUNT_CHIP` tightened: 4px inside, 3px between the dot, the name
 * and the number (beside it), 10.5px (11px from 1440). Its focus ring is drawn inside it: the strip's
 * box clips what lies outside.
 */
export const HEAD_CHIP =
  'inline-flex h-[26px] shrink-0 items-center gap-[3px] whitespace-nowrap rounded-lg border px-1 text-[10.5px] font-bold leading-none transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60 min-[1440px]:text-[11px]';

/** A total's figure, beside its name: 11px (11.5 from 1440), the figures' face. */
export const HEAD_FIGURE = 'text-[11px] font-black min-[1440px]:text-[11.5px]';

/** A count chip's face: pressed (the filter is on) or not, and dimmed at zero. */
export const countChipTone = (on: boolean, count: number): string =>
  cn(
    on
      ? 'border-brand-500 bg-brand-500/15 text-brand-800 dark:border-brand-400 dark:text-brand-100'
      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-[#0a1233] dark:text-slate-200 dark:hover:border-slate-600',
    count === 0 && !on && 'opacity-55',
  );

/** A dot of the strip that is no type's colour — «الإجمالي», «بدون نوع», a crew's state. */
export const PlainDot = ({ tone }: { tone: string }): JSX.Element => (
  <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', tone)} />
);

/**
 * The page under the toolbar and the bar: below 1360 nothing is pinned — the page scrolls, the pools
 * above the table (beside it, a 1280 laptop left the table 90px short and scrolling sideways; a
 * height limit there also squeezed the pools to nothing on a phone). From 1360 the grid takes the
 * height left, and the table and each pool scroll inside it.
 */
export const CREW_PLAN_GRID =
  'grid shrink-0 gap-3 min-[1360px]:min-h-0 min-[1360px]:flex-1 min-[1360px]:shrink min-[1360px]:grid-cols-[minmax(0,1fr)_14rem] min-[1700px]:grid-cols-[minmax(0,1fr)_29rem]';

/** The two pools — side by side on a tablet and from 1700, one over the other at 1360–1700. */
export const CREW_PLAN_POOLS =
  'grid gap-3 sm:grid-cols-2 min-[1360px]:col-start-2 min-[1360px]:row-start-1 min-[1360px]:min-h-0 min-[1360px]:grid-cols-1 min-[1360px]:grid-rows-2 min-[1700px]:grid-cols-2 min-[1700px]:grid-rows-1';

/** One pool's height: a fixed list on a phone and a tablet, the grid's from 1360. */
export const CREW_PLAN_POOL_HEIGHT = 'h-[20rem] min-[1360px]:h-auto';

/** The table's side of the grid. */
export const CREW_PLAN_TABLE_SIDE =
  'flex min-w-0 flex-col min-[1360px]:col-start-1 min-[1360px]:row-start-1 min-[1360px]:min-h-0';

/**
 * Somebody the roster no longer names (left since the plan was saved): still shown, never a raw id.
 * Asserted rather than annotated: the roster's DTO grows fields this stand-in has no value for. The
 * ones the chip's person card reads (Round 22) are here, as «nothing on file» — a dash on the card.
 */
export const unknownMember = (employeeId: string, name: string): OperationsCrewMemberDto =>
  ({
    employeeId,
    code: '—',
    fullNameAr: name,
    status: 'unknown',
    jobTitle: null,
    phone: null,
    branchId: null,
    requirements: null,
    assignedVehicleId: null,
  }) as OperationsCrewMemberDto;

/**
 * What is under the pointer during a drag, read off the marks the board draws (the DOM half of
 * `targetFromMarks`): the nearest slot, row and pool around the element. A text node answers through
 * its parent.
 */
export const targetAt = (node: EventTarget | null): DropTarget | null => {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (element === null) return null;
  const mark = (name: string): string | null =>
    element.closest(`[${name}]`)?.getAttribute(name) ?? null;
  return targetFromMarks({
    slotZone: mark('data-slot-zone'),
    rowKey: mark('data-plan-row'),
    pool: mark('data-plan-pool'),
  });
};

/** What the hand holds: the chip picked up, by name, with «إلغاء» (Escape puts it down too). */
export const PickedPill = ({
  name,
  onCancel,
  className,
}: {
  name: string;
  onCancel: () => void;
  className?: string;
}): JSX.Element => {
  const t = useT();
  return (
    <p
      data-crew-picked="true"
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12.5px] font-bold text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100',
        className,
      )}
    >
      <span className="min-w-0 truncate">{t('operations.crewPlan.picked', { name })}</span>
      <button
        type="button"
        data-crew-picked-cancel="true"
        onClick={onCancel}
        className="shrink-0 rounded-md bg-amber-200/70 px-2 py-0.5 text-[11.5px] font-black text-amber-900 hover:bg-amber-200 dark:bg-amber-400/20 dark:text-amber-100"
      >
        {t('operations.crewPlan.cancelPick')}
      </button>
    </p>
  );
};

/**
 * The toolbar's start: the page's totals (`children`), on ONE line, and a chip picked up — by name,
 * with «إلغاء» (Escape puts it down too) — at that line's start, beside them: «بدل ما انت لما بختار
 * حاجه بينزل سطر ل تحت» (Round 34 E on the board; Round 34 G on «الطاقم الثابت», whose legend and hint
 * went the board's way — the role colours are on every chip and on the pools' heads, and every empty
 * slot says «+ اختيار»). The pill is no taller than the line (34px) and takes at most 70% of it; the
 * totals keep the rest — still seen, still pressed (a chip narrows the rows while somebody is held),
 * scrolling sideways inside their box when the room is short — so picking somebody moves nothing.
 * The words are said aloud: the spoken region is there, empty, before anything is picked.
 */
export const CrewPlanHand = ({
  pickedName,
  onCancel,
  children,
  className,
}: {
  pickedName: string | null;
  onCancel: () => void;
  children: ReactNode;
  className?: string;
}): JSX.Element => {
  const holding = pickedName !== null;
  return (
    <div className={cn('flex min-w-0 items-center', className)} data-crew-plan-head="true">
      <div
        aria-live="polite"
        data-crew-plan-head-hand="true"
        className={cn('flex min-w-0 items-center', holding && 'max-w-[70%] shrink-0 pe-2')}
      >
        {holding && (
          <PickedPill
            name={pickedName}
            onCancel={onCancel}
            className="h-[30px] min-w-0 !py-0 shadow-sm"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2" data-crew-plan-head-idle="true">
        {children}
      </div>
    </div>
  );
};

/**
 * Where the board — and, since Round 34 G, «الطاقم الثابت» — draws «المعروض N من M». From 1280 the
 * toolbar is one line and the bar keeps room at its end (Round 34 E): `bar`. Below it, from about
 * 1060px, the board's five filters fill its bar's first line and the count wrapped onto a line of its
 * own — the table moved on every choice, «لما بختار حاجه بينزل سطر ل تحت» (Round 34 verifier).
 * There it stands at the END OF THE TOTALS' line (`head`): that line never wraps — the totals give
 * way and scroll inside their box — so the count can never add a line, at any width, a phone's
 * included; the acts' line keeps its whole width for the acts' words, and on a phone the type's box
 * keeps the bar's (Round 34 critic).
 */
export const filteredCountAt = (width: {
  /** From 1280: the totals and the acts on ONE toolbar line. */
  oneLineHead: boolean;
}): 'bar' | 'head' => (width.oneLineHead ? 'bar' : 'head');

/**
 * What the filters leave, beside the chips that count everything — and one press to show all.
 * `compact` (a phone): the figures alone, «٩ من ٢٦٥», and «مسح التصفية» an ✕ — each keeps its whole
 * words as its name and its tooltip — so the totals beside them keep some room.
 */
export const FilteredCount = ({
  shown,
  total,
  onClear,
  compact = false,
}: {
  shown: number;
  total: number;
  onClear: () => void;
  compact?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const figures = { shown: formatNumber(shown, locale), total: formatNumber(total, locale) };
  const words = t('operations.crewPlan.filter.shown', figures);
  const clear = t('operations.crewPlan.filter.clear');
  return (
    <span className="flex shrink-0 items-center gap-1.5" data-crew-plan-filtered="true">
      <span
        className={cn(
          COUNT_CHIP,
          'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-100',
        )}
        data-shown-count={String(shown)}
        title={compact ? words : undefined}
      >
        {compact ? (
          <>
            <span aria-hidden>{t('operations.crewPlan.filter.shownShort', figures)}</span>
            <span className="sr-only">{words}</span>
          </>
        ) : (
          words
        )}
      </span>
      <button
        type="button"
        data-crew-plan-clear-filters="true"
        onClick={onClear}
        aria-label={compact ? clear : undefined}
        title={compact ? clear : undefined}
        className={cn(
          COUNT_CHIP,
          'border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:text-rose-700 dark:border-slate-700 dark:bg-[#0a1233] dark:text-slate-200 dark:hover:text-rose-300',
          compact && 'h-[26px] w-[26px] justify-center !px-0',
        )}
      >
        <CloseIcon className="h-3 w-3" />
        {!compact && clear}
      </button>
    </span>
  );
};

/**
 * A reader without the planning grant (Round 34 E — no line of words over the totals): a lock and
 * «للعرض فقط» in words, seen on a phone and by the keyboard as by the mouse (Round 34 critic — a lock
 * alone said it only in a hover's tooltip). Why, in full, is its tooltip and what a screen reader
 * says — in the words of the screen it is on (`scopedKey`): «يمكنك الاطلاع على التشغيلة؛ أما التوزيع
 * فيحتاج صلاحية تخطيط الطاقم.» on the board, «يمكنك الاطلاع على الطاقم الثابت؛ أما تعديله فيحتاج صلاحية
 * تخطيط الطاقم.» on «الطاقم الثابت» (Round 34 G — the hint's line there gave way to it).
 */
export const ViewOnlyMark = ({ className }: { className?: string }): JSX.Element => {
  const t = useT();
  const why = t(scopedKey(useCrewPlanScope(), 'operations.crewPlan.viewOnly'));
  return (
    <span
      data-crew-view-only="true"
      title={why}
      className={cn(
        'inline-flex shrink-0 cursor-help items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-black text-slate-600 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:border-slate-700 dark:bg-[#0a1233] dark:text-slate-300',
        className,
      )}
    >
      <BoardIcon d={[...PATH.lock]} className="h-3.5 w-3.5" />
      <span aria-hidden>{t('operations.crewPlan.viewOnlyMark')}</span>
      <span className="sr-only">{why}</span>
    </span>
  );
};

/** What a record says, line by line: the day, what a record is, and — when any — the work lost. */
const recordLines = (
  t: ReturnType<typeof useT>,
  dayLabel: string,
  lostCount: string | null,
): string[] => [
  t('operations.crewPlan.record.title', { day: dayLabel }),
  t('operations.crewPlan.record.body'),
  ...(lostCount === null ? [] : [t('operations.crewPlan.record.unsaved', { count: lostCount })]),
];

/**
 * Round 34 H — a past day's record, said on the toolbar's line: «سجل · للعرض فقط» in words, and what
 * Round 32's notice under the bar said — «سجل يوم … — للعرض فقط، لا يمكن التعديل» and what a record is —
 * in a card of its own and in what a screen reader says (`role="status"`, as the notice). The notice
 * took a line of its own (62px and its gap: the table 78px down on opening a past day): «بدل ما انت
 * لما بختار حاجه بينزل سطر ل تحت». Work left unsaved when the day ended (`lost`, the board's
 * `lostOnRecord` — said once by a toast as it happens) stays on the mark while the record stands:
 * amber, its count in a badge, «التغييرات غير المحفوظة: …» in its card and its words.
 * `data-crew-record` names the day.
 *
 * Round 34 H critic — the card is a TOGGLE, not the browser's `title`: the mark is a button, and a
 * press, a tap or the keyboard's focus opens the card (`useHoverCard`'s `toggle`), as the pointer
 * does after a beat; a press again, a press elsewhere, Escape or leaving it by Tab closes it. A
 * `title` reached the mouse alone — on a phone, and to a sighted keyboard user, once the toast had
 * gone the amber «١» said nothing of what it counts. The card is drawn in the hover cards' layer
 * over the page: opening it moves nothing.
 */
export const RecordMark = ({
  day,
  dayLabel,
  lost,
  className,
  iconClassName,
}: {
  /** The day, `YYYY-MM-DD`. */
  day: string;
  /** The day as the reader reads it. */
  dayLabel: string;
  /** Changes the day's end left unsaved — 0 for none. */
  lost: number;
  className?: string;
  /** The lock's — the board leaves it out on a narrow phone, where the words say it. */
  iconClassName?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const count = formatNumber(lost, locale);
  const lines = recordLines(t, dayLabel, lost > 0 ? count : null);
  // A button takes the focus of its own: no tab stop to add. The card is not its description — the
  // words below are, and a screen reader would read them twice.
  const card = useHoverCard(true, { toggle: true, focusable: false });
  const trigger = { ...card.triggerProps };
  delete trigger['aria-describedby'];
  const wordsId = useId();
  return (
    <span
      role="status"
      data-crew-record-mark="true"
      data-crew-record={day}
      data-crew-record-lost={lost > 0 ? String(lost) : undefined}
      className="inline-flex shrink-0"
    >
      <button
        type="button"
        {...trigger}
        aria-expanded={card.open}
        aria-describedby={wordsId}
        data-crew-record-toggle="true"
        className={cn(
          'inline-flex shrink-0 cursor-help items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1.5 text-[11px] font-black transition focus:outline-none focus-visible:ring-2 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs',
          lost > 0
            ? 'border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 focus-visible:ring-amber-500/60 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100 dark:hover:border-amber-400/70'
            : 'border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300 focus-visible:ring-sky-500/60 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200 dark:hover:border-sky-400/60',
          className,
        )}
      >
        <BoardIcon d={[...PATH.lock]} className={cn('h-3.5 w-3.5', iconClassName)} />
        <span>{t('operations.crewPlan.record.mark')}</span>
        {lost > 0 && (
          <span
            aria-hidden
            data-crew-record-lost-count="true"
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-700 px-1 text-[10px] font-black leading-none text-white dark:bg-amber-400 dark:text-slate-950"
          >
            {count}
          </span>
        )}
      </button>
      <span id={wordsId} className="sr-only">
        {lines.join(' ')}
      </span>
      {card.open && (
        <HoverCardLayer id={card.id} anchor={card.anchor} mark="crew-record">
          <RecordCardBody dayLabel={dayLabel} lost={lost} />
        </HoverCardLayer>
      )}
    </span>
  );
};

/**
 * The record mark's card (Round 34 H critic), seen: the day in bold beside the lock, what a record
 * is, and the work the day's end left unsaved in the mark's amber — the three lines the notice under
 * the bar showed before Round 34 H, in the hover cards' frame (both themes).
 */
export const RecordCardBody = ({
  dayLabel,
  lost,
}: {
  dayLabel: string;
  lost: number;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const title = t('operations.crewPlan.record.title', { day: dayLabel });
  const body = t('operations.crewPlan.record.body');
  const unsaved =
    lost > 0
      ? t('operations.crewPlan.record.unsaved', { count: formatNumber(lost, locale) })
      : null;
  return (
    <span className="block" data-crew-record-card="true">
      <span className="flex items-start gap-2">
        <span aria-hidden className={HOVER_CARD_ICON}>
          <BoardIcon d={[...PATH.lock]} className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-black leading-snug" data-crew-record-card-title="true">
          {title}
        </span>
      </span>
      <span className="mt-1.5 block text-[12.5px] font-semibold leading-5 text-slate-600 dark:text-slate-300">
        {body}
      </span>
      {unsaved !== null && (
        <span
          data-crew-record-card-unsaved="true"
          className="mt-2 block rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[12.5px] font-bold leading-5 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100"
        >
          {unsaved}
        </span>
      )}
    </span>
  );
};

/** A seated chip picked up: the keyboard's way to send it back to the pools («إخراج …»). */
export const ReturnPickedButton = ({
  pool,
  name,
  onReturn,
}: {
  pool: string;
  name: string;
  onReturn: () => void;
}): JSX.Element => {
  const t = useT();
  const scope = useCrewPlanScope();
  return (
    <button
      type="button"
      data-return-picked={pool}
      onClick={onReturn}
      className="mb-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-brand-400 bg-brand-500/10 py-1.5 text-[12px] font-black text-brand-700 hover:bg-brand-500/20 dark:text-brand-200"
    >
      <BoardIcon d={SHIPMENT_PATH.undo} className="h-3.5 w-3.5" />
      {t(scopedKey(scope, 'operations.crewPlan.pools.returnPicked'), { name })}
    </button>
  );
};
