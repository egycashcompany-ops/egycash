// The controls in a «لوحة التشغيلة» row, each with a list of its own:
//
//   · الاتجاه — a box you TYPE in to narrow the list of areas (the areas catalog — the names the bank
//     branches' areas use). Round 20 held its value to that list («لازم اختار من الاتجاهات اللى
//     موجوده بتاعت البنوك»); Round 28 reverses it — «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى
//     الليست»: text that is not exactly an area is offered as «استخدام «…» اتجاهًا» and taken as
//     typed. An area's name typed out in full is still taken in the AREA'S OWN spelling — the
//     server's own rule (`canonicalOperationsDirection`), so «المعادى» typed is saved as «المعادي».
//     The list and the leaving rule are `lib/direction-pick.ts`. Round 28c — «يعرض عليا اضيفه او لا»:
//     beside it, «إضافة «…» إلى القائمة» adds the name to «المناطق» for a desk who may write the
//     catalog (`add`, `api/direction-area.ts`), the row pending while it is written;
//   · التوقيت — «التوقيت اعملى حاجه اختار منها زى التاريخ»: the date box's look (the cyan icon at its
//     start), and a picker of hours and minutes behind the icon; a time can still be typed;
//   · النوع — «انا عاوز النوع يكون بيضاف من البيانات المرجعيه»: the ACTIVE types of «أنواع التشغيل»,
//     in the catalog's order, as coloured tags; a type the row holds that was archived since stays,
//     marked. In the row it is a BOX like the time's and the notes' — «شكلها فى الشاشة تكون زى الساعة
//     والملاحظات كله تحت بعض مفيش حاجه داخلة وحاجه خارجه»: the same height, border, corners and
//     padding, filling its column, the type's colour a dot at the box's start where the time's clock
//     sits — so the column's boxes stand one under the other, none narrower, none sticking out;
//   · the row's COLOUR — «زرار يبقى فى كذا لون اقدر الون به الصف»; since Round 24b the types' palette
//     (as many swatches as there are types) over the type's own colour, and «لون النوع»;
//   · a vehicle-less row's «اختيار سيارة» — since Round 24 only its button: the list of every car
//     with no crew that day is the page's (`CrewVehiclePicker`).
//
// WHY THEIR LISTS FLOAT. They live in a table that scrolls; a list drawn inside a cell is cut by
// the table's edge on the last rows. Each list is drawn over the page (a portal, fixed), placed by
// the shared rule every floating list uses (`floatingSpot`): under its control, or over it when
// there is more room above; kept in place while anything under it scrolls; closed by Escape (the
// focus back on its control), by a click outside, or by a choice.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  OPERATIONS_DIRECTION_MAX_LENGTH,
  normalizeOperationsDirection,
  type Locale,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { Spinner } from '../../../shared/ui/Spinner';
import { floatingSpot, type FloatingSpot } from '../../../shared/ui/MultiSelect';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import { parseClock, shiftTypeChoices, type CrewRowColour } from '../lib/crew-plan';
import {
  directionAddOffer,
  directionItems,
  directionItemsAtOpen,
  directionOnLeave,
  directionTooLong,
  highlightedDirectionRow,
  isHandTypedDirection,
  opensOnText,
  withDirectionAdd,
  type DirectionAddRefused,
  type DirectionItem,
} from '../lib/direction-pick';
import { type DirectionAdd } from '../api/direction-area';
import { gridStep, type CatalogState, type RowColourChoice } from '../lib/type-colours';
import { PLAN_ICON } from './crew-plan-icons';
import { SHIFT_TYPE_TONE, ShiftTypeDot, ShiftTypeTag, shiftTypeName } from './shift-type-look';

// ── The looks ────────────────────────────────────────────────────────────────────────────────────

/** A text box in a row — the boards' filter boxes' surface, a size smaller. */
export const CELL_BOX =
  'h-8 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 text-[12.5px] font-bold text-slate-900 placeholder:font-semibold placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/80 dark:bg-[#080C14] dark:text-slate-100 dark:placeholder:text-slate-500';

/**
 * A box refused by the last save — the row the server named, the cell it was about. Doubled, to
 * outrank the box's own border colour whatever their CSS order.
 */
export const REFUSED_BOX =
  '[&&]:border-rose-500 [&&]:ring-2 [&&]:ring-rose-500/30 dark:[&&]:border-rose-400';

/** A value the box keeps but the catalog no longer offers (an archived type). */
const KEPT_BOX =
  '[&&]:border-amber-400 [&&]:text-amber-800 dark:[&&]:border-amber-500/70 dark:[&&]:text-amber-200';

const PANEL =
  'z-[70] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-900/15 animate-menu-in dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/60';

const OPTION =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] font-bold text-slate-800 transition hover:bg-brand-500/10 focus:outline-none focus-visible:bg-brand-500/15 dark:text-slate-100';

// ── The floating list ────────────────────────────────────────────────────────────────────────────

/** Where the list goes, kept in place while anything under it scrolls or the window resizes. */
const useFloatingSpot = (
  anchor: RefObject<HTMLElement>,
  open: boolean,
  width: number,
): FloatingSpot | null => {
  const [spot, setSpot] = useState<FloatingSpot | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setSpot(null);
      return undefined;
    }
    const place = (): void => {
      const element = anchor.current;
      if (element === null) return;
      setSpot(
        floatingSpot(element.getBoundingClientRect(), Math.min(width, window.innerWidth - 16), {
          width: window.innerWidth,
          height: window.innerHeight,
          rtl: getComputedStyle(element).direction === 'rtl',
        }),
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, open, width]);
  return spot;
};

/** A list drawn over the page, under (or over) its control. */
export const FloatingPanel = ({
  anchor,
  open,
  onClose,
  width,
  children,
  className,
  ...rest
}: {
  anchor: RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  width: number;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement> &
  Record<`data-${string}`, string>): JSX.Element | null => {
  const spot = useFloatingSpot(anchor, open, width);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      close.current();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [anchor, open]);

  if (!open || spot === null) return null;
  return createPortal(
    <div
      {...rest}
      ref={panel}
      onKeyDown={(event) => {
        rest.onKeyDown?.(event);
        if (event.key !== 'Escape') return;
        // The list's Escape alone: the page's own Escape (dropping a picked-up chip) must not fire.
        event.preventDefault();
        event.stopPropagation();
        close.current();
        anchor.current?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
      }}
      style={{
        position: 'fixed',
        left: spot.left,
        width: Math.min(width, window.innerWidth - 16),
        maxHeight: spot.maxHeight,
        ...(spot.below ? { top: spot.top } : { bottom: spot.bottom }),
      }}
      className={cn(PANEL, className)}
    >
      {children}
    </div>,
    document.body,
  );
};

/** Arrow keys walk a list's buttons; the focus wraps at either end. */
const walk = (event: KeyboardEvent<HTMLElement>): void => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const list = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
  );
  const at = list.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
  list[(next + list.length) % list.length]?.focus();
};

/** Focus the chosen (or first) button of a list once it is drawn. */
const useFocusOnOpen = (open: boolean, selector: string): void => {
  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(selector);
      (
        panel?.querySelector<HTMLButtonElement>('[aria-selected=true], [aria-pressed=true]') ??
        panel?.querySelector<HTMLButtonElement>('button')
      )?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, selector]);
};

// ── الاتجاه ──────────────────────────────────────────────────────────────────────────────────────

/** The id of the direction list's row `index` — the clear row is `items.length`. */
const directionOptionId = (listId: string, index: number): string => `${listId}-option-${index}`;

/** «إضافة «…» إلى القائمة»'s plus, where the typed row has its pen and an area its pin. */
const ADD_ICON = ['M12 5v14', 'M5 12h14'];

/**
 * The rows of the direction box's list (`directionItems`): the areas, «استخدام «…» اتجاهًا» — the
 * text as typed, with a pen where an area has its pin, set apart by a line when areas precede it —
 * and «مسح الاتجاه» when the row has one. Its own component so the rows are rendered, and pinned,
 * without opening the list.
 *
 * Round 28 critic — a combobox's rows, said to a screen reader: each has an id the box names as its
 * active row (`aria-activedescendant`), «مسح الاتجاه» is reached by the arrows too (it is the row
 * after the last item), and a typed row equal to the value is the selected one. Text typed past the
 * ceiling (`tooLong`) is said, not cut without a word.
 *
 * Round 28c — «إضافة «…» إلى القائمة» (an `add` item, a plus where the typed row has its pen) sits
 * right after the typed row, its hint under it: written to «المناطق» at once, not at «حفظ», and
 * «تراجع» does not take it back. An archived area that holds the name is said instead
 * (`archivedArea`); an add «المناطق» refused is said at the top (`refused`), the text kept.
 */
export const DirectionOptions = ({
  listId,
  items,
  active,
  value,
  tooLong = null,
  archivedArea = null,
  refused = null,
  onHover,
  onPick,
  onAdd,
}: {
  /** The list's id — each row's is made from it (`directionOptionId`). */
  listId: string;
  items: readonly DirectionItem[];
  /** The highlighted row — what Enter takes; `items.length` is «مسح الاتجاه». */
  active: number;
  value: string | null;
  /** The length of text typed past `OPERATIONS_DIRECTION_MAX_LENGTH` (`directionTooLong`). */
  tooLong?: number | null;
  /** An archived area that holds what is typed — said, and no add offered (`directionAddOffer`). */
  archivedArea?: string | null;
  /** The add «المناطق» just refused for this text, said above the rows. */
  refused?: DirectionAddRefused | null;
  onHover: (index: number) => void;
  onPick: (direction: string | null) => void;
  /** «إضافة «…» إلى القائمة» picked — the name to add. */
  onAdd?: (name: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  return (
    <>
      {refused !== null && (
        <li
          role="alert"
          data-direction-add-refused={refused.reason}
          className="px-2.5 py-2 text-[12.5px] font-bold leading-snug text-rose-700 dark:text-rose-300"
        >
          {t(`operations.crewPlan.direction.addRefused.${refused.reason}`, { text: refused.name })}
        </li>
      )}
      {tooLong !== null && (
        <li
          role="presentation"
          data-direction-too-long="true"
          className="px-2.5 py-2 text-[12.5px] font-bold leading-snug text-amber-800 dark:text-amber-200"
        >
          {t('operations.crewPlan.direction.tooLong', {
            max: formatNumber(OPERATIONS_DIRECTION_MAX_LENGTH, locale),
            count: formatNumber(tooLong, locale),
          })}
        </li>
      )}
      {items.length === 0 && tooLong === null && (
        <li
          role="presentation"
          className="px-2.5 py-2 text-[12.5px] font-semibold text-slate-500 dark:text-slate-400"
        >
          {t('operations.crewPlan.direction.empty')}
        </li>
      )}
      {items.map((item, index) => (
        <li
          key={`${item.kind}:${item.direction}`}
          id={directionOptionId(listId, index)}
          role="option"
          aria-selected={item.kind !== 'add' && item.direction === value}
          data-direction-option={item.kind}
          data-active={index === active ? 'true' : undefined}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (item.kind === 'add' ? onAdd?.(item.direction) : onPick(item.direction))}
          className={cn(
            OPTION,
            'cursor-pointer',
            index === active && 'bg-brand-500/10 dark:bg-brand-500/15',
            item.kind !== 'add' && item.direction === value && 'text-brand-700 dark:text-brand-200',
            // The typed text stands apart from the areas: a line above it when areas precede.
            item.kind === 'typed' &&
              index > 0 &&
              items[index - 1]?.kind === 'area' &&
              'mt-1 border-t border-slate-100 pt-2 dark:border-slate-800',
            item.kind === 'add' && 'items-start',
          )}
        >
          <BoardIcon
            d={
              item.kind === 'area'
                ? PLAN_ICON.pin
                : item.kind === 'typed'
                  ? PLAN_ICON.pen
                  : ADD_ICON
            }
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              item.kind === 'area' && 'text-slate-400',
              item.kind === 'typed' && 'text-brand-600 dark:text-brand-300',
              item.kind === 'add' && 'mt-0.5 text-emerald-600 dark:text-emerald-300',
            )}
          />
          {item.kind === 'area' ? (
            <span className="min-w-0 break-words">{item.direction}</span>
          ) : item.kind === 'typed' ? (
            <span className="min-w-0 break-words">
              {t('operations.crewPlan.direction.useTyped', { text: item.direction })}
            </span>
          ) : (
            <span className="min-w-0">
              <span className="block break-words">
                {t('operations.crewPlan.direction.addToList', { text: item.direction })}
              </span>
              <span
                data-direction-add-hint="true"
                className="mt-0.5 block text-[11.5px] font-semibold leading-snug text-slate-500 dark:text-slate-400"
              >
                {t('operations.crewPlan.direction.addHint')}
              </span>
            </span>
          )}
        </li>
      ))}
      {archivedArea !== null && (
        <li
          role="presentation"
          data-direction-archived="true"
          className="px-2.5 py-2 text-[12px] font-semibold leading-snug text-amber-800 dark:text-amber-200"
        >
          {t('operations.crewPlan.direction.archived', { area: archivedArea })}
        </li>
      )}
      {value !== null && (
        <li
          id={directionOptionId(listId, items.length)}
          role="option"
          aria-selected={false}
          data-direction-option="clear"
          data-active={active === items.length ? 'true' : undefined}
          onMouseEnter={() => onHover(items.length)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(null)}
          className={cn(
            OPTION,
            'mt-1 cursor-pointer border-t border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400',
            active === items.length && 'bg-brand-500/10 dark:bg-brand-500/15',
          )}
        >
          {t('operations.crewPlan.direction.clear')}
        </li>
      )}
    </>
  );
};

export const DirectionPicker = ({
  rowKey,
  value,
  options,
  disabled,
  onChange,
  add,
}: {
  rowKey: string;
  value: string | null;
  /** The areas' names — what the list offers; a direction typed by hand is taken too (Round 28). */
  options: readonly string[];
  disabled: boolean;
  onChange: (next: string | null) => void;
  /**
   * Round 28c — «إضافة «…» إلى القائمة», for a desk who may write «المناطق» (the catalog's own
   * grant); left out, the list never offers it. While the add is written the box shows the name,
   * pending, and takes nothing more; a refusal keeps the name, said, for the row instead.
   */
  add?: DirectionAdd | undefined;
}): JSX.Element => {
  const t = useT();
  const id = useId();
  const noteId = `${id}-note`;
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Has the desk typed since the box opened? Until then the list is the box's opening list
  // (`directionItemsAtOpen`) and leaving it changes nothing.
  const [edited, setEdited] = useState(false);
  const [active, setActive] = useState(0);
  // Have the arrows moved the highlight since the last keystroke? (`highlightedDirectionRow`)
  const [arrowed, setArrowed] = useState(false);
  // The mouse-up of the click that focused the box would undo its select-all (Round 28 critic).
  const keepSelection = useRef(false);
  const current = value ?? '';
  // A direction typed by hand (Round 28), or written before the list existed: shown plainly, with a
  // pen at its start (Round 28 critic — a title alone never shows on a phone), and said: it is no
  // area, and what that means for «توزيع المحصنات».
  const handTyped = isHandTypedDirection(value, options);
  // Round 28 critic — a value that is not one area opens as its own text, whole and editable.
  const seeded = opensOnText(value, options);
  // Round 28c — the add to «المناطق»: offered only with `add`, for one new name (`directionAddOffer`).
  const offering = add !== undefined;
  const archived = add?.archived ?? null;
  const pending = add?.pending ?? null;
  const refused = add?.refused ?? null;
  const offer = useMemo(
    () => (offering && edited ? directionAddOffer(query, options, archived, refused) : null),
    [archived, edited, offering, options, query, refused],
  );

  const items = useMemo(
    () =>
      withDirectionAdd(
        edited ? directionItems(query, options) : directionItemsAtOpen(value, options),
        offer,
      ),
    [edited, offer, options, query, value],
  );
  const tooLong = edited ? directionTooLong(query, options) : null;
  // The refusal is said while the list holds the very name refused.
  const refusalShown =
    refused !== null && edited && normalizeOperationsDirection(query) === refused.name
      ? refused
      : null;
  /** What the box says of itself: the add pending, the add refused, a hand-typed value — or none. */
  const note =
    pending !== null
      ? t('operations.crewPlan.direction.adding', { text: pending })
      : refused !== null
        ? t(`operations.crewPlan.direction.addRefused.${refused.reason}`, { text: refused.name })
        : handTyped
          ? t('operations.crewPlan.direction.handTyped', { direction: current })
          : null;
  /** Rows the arrows walk: the items, then «مسح الاتجاه» when the row has a direction. */
  const count = items.length + (value !== null ? 1 : 0);
  /** The highlighted row — what Enter takes; -1 for none. */
  const lit = highlightedDirectionRow(items.length, active, value !== null, arrowed);

  useEffect(() => {
    if (open)
      document.getElementById(directionOptionId(id, lit))?.scrollIntoView({ block: 'nearest' });
  }, [lit, id, open]);

  /** Open the list on the box's own value — its text kept when it is not one area. */
  const openList = (): void => {
    // Round 28c — nothing opens while the add is written: the row is pending.
    if (open || pending !== null) return;
    setOpen(true);
    setArrowed(false);
    if (refused !== null) {
      // The refused name comes back, the refusal said above it: nothing typed is lost.
      setEdited(true);
      setQuery(refused.name);
      setActive(0);
      return;
    }
    setEdited(false);
    setQuery(seeded ? current : '');
    const at = directionItemsAtOpen(value, options).findIndex((item) => item.direction === value);
    setActive(at === -1 ? 0 : at);
  };
  const close = (): void => {
    setOpen(false);
    setEdited(false);
    setQuery('');
  };
  /** A refused add is answered — by a pick, by leaving, by Escape — and said no more. */
  const settleRefusal = (): void => {
    if (refused !== null) add?.onSettle();
  };
  const commit = (option: string | null): void => {
    close();
    settleRefusal();
    if (option !== value) onChange(option);
  };
  /** «إضافة «…» إلى القائمة» — written at once; the row takes the area once the catalog has it. */
  const addToList = (name: string): void => {
    if (add === undefined || pending !== null) return;
    close();
    add.onAdd(name);
  };
  /**
   * Leaving the box (`directionOnLeave`): an area's name typed in full is taken in the area's
   * spelling, a half-typed word of an area goes back to the value (the desk was searching), and
   * anything else is taken as typed. Nothing typed since it opened is nothing to take.
   */
  const leave = (): void => {
    const taken = edited ? directionOnLeave(query, options) : null;
    close();
    settleRefusal();
    if (taken !== null && taken !== value) onChange(taken);
  };

  // Round 28c — a refusal that comes back while the box still has the focus opens the list on the
  // name refused, the refusal said, «استخدام «…» اتجاهًا» first: the desk carries on from there.
  const seenRefusal = useRef<DirectionAddRefused | null>(null);
  useEffect(() => {
    const fresh = refused !== null && refused !== seenRefusal.current;
    seenRefusal.current = refused;
    if (!fresh || refused === null || document.activeElement !== input.current) return;
    setOpen(true);
    setEdited(true);
    setQuery(refused.name);
    setActive(0);
    setArrowed(false);
  }, [refused]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // Round 28c — while the add is written the box takes no key but Tab: a second Enter adds nothing.
    if (pending !== null) {
      if (event.key !== 'Tab') event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setArrowed(true);
      setActive((at) =>
        count === 0 ? 0 : (at + (event.key === 'ArrowDown' ? 1 : -1) + count) % count,
      );
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      // The highlighted row — an area, «استخدام «…» اتجاهًا», «إضافة «…» إلى القائمة», or «مسح الاتجاه».
      if (lit === -1) return;
      if (lit === items.length && value !== null) {
        commit(null);
        return;
      }
      const picked = items[lit];
      if (picked?.kind === 'add') addToList(picked.direction);
      else if (picked !== undefined) commit(picked.direction);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      settleRefusal();
      return;
    }
    if (event.key === 'Tab' && open) leave();
  };

  return (
    <div ref={box} className="relative" data-direction-picker={rowKey}>
      {/* The pen marks the row's own hand-typed value — not a name pending or refused. */}
      {handTyped && pending === null && refused === null && (
        <span
          aria-hidden
          data-direction-hand-typed-mark="true"
          className="pointer-events-none absolute start-2 top-2 text-slate-400 dark:text-slate-500"
        >
          <BoardIcon d={PLAN_ICON.pen} className="h-4 w-4" />
        </span>
      )}
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={t('operations.crewPlan.columns.direction')}
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open && lit !== -1 ? directionOptionId(id, lit) : undefined}
        aria-describedby={note !== null ? noteId : undefined}
        aria-busy={pending !== null ? true : undefined}
        aria-invalid={refused !== null ? true : undefined}
        autoComplete="off"
        disabled={disabled}
        // Round 28c — while the add is written the box holds the name: nothing typed over it.
        readOnly={pending !== null}
        placeholder={t('operations.crewPlan.columns.direction')}
        title={note ?? current}
        data-direction-hand-typed={handTyped ? 'true' : undefined}
        data-direction-adding={pending !== null ? 'true' : undefined}
        data-direction-add-refused={refused?.reason}
        // Closed, the box shows the name being added, or the one refused (kept, not lost).
        value={open ? query : (pending ?? refused?.name ?? current)}
        onFocus={(event) => {
          openList();
          // Its own text, all of it chosen: typed over at once, or a word of it fixed in place.
          if (seeded && pending === null && refused === null) {
            event.currentTarget.select();
            keepSelection.current = true;
          }
        }}
        onMouseUp={(event) => {
          if (!keepSelection.current) return;
          keepSelection.current = false;
          event.preventDefault();
        }}
        onClick={openList}
        onChange={(event) => {
          if (pending !== null) return;
          if (!open) setOpen(true);
          setQuery(event.target.value);
          setEdited(true);
          setActive(0);
          setArrowed(false);
        }}
        onBlur={(event) => {
          keepSelection.current = false;
          // A click on the list keeps the focus on the box (its rows prevent the blur); anything
          // else that takes it away is leaving.
          if (!box.current?.contains(event.relatedTarget as Node | null)) {
            if (open) leave();
          }
        }}
        onKeyDown={onKeyDown}
        className={cn(
          CELL_BOX,
          'pe-6',
          handTyped && pending === null && refused === null && 'ps-7',
          refused !== null && REFUSED_BOX,
        )}
      />
      {note !== null && (
        <span id={noteId} className="sr-only" role={pending !== null ? 'status' : undefined}>
          {note}
        </span>
      )}
      {pending !== null ? (
        <span
          data-direction-adding-spinner="true"
          className="pointer-events-none absolute end-1.5 top-2 text-brand-600 dark:text-brand-300"
        >
          <Spinner className="h-4 w-4" />
        </span>
      ) : (
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="pointer-events-none absolute end-1.5 top-2 h-4 w-4 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {/* A click outside is LEAVING the box — the same rule as Tab (`directionOnLeave`). */}
      <FloatingPanel
        anchor={box}
        open={open}
        onClose={leave}
        width={240}
        data-direction-list={rowKey}
      >
        <ul id={id} role="listbox" aria-label={t('operations.crewPlan.columns.direction')}>
          <DirectionOptions
            listId={id}
            items={items}
            active={lit}
            value={value}
            tooLong={tooLong}
            archivedArea={offer?.kind === 'archived' ? offer.area : null}
            refused={refusalShown}
            onHover={(index) => {
              setActive(index);
              setArrowed(true);
            }}
            onPick={commit}
            onAdd={addToList}
          />
        </ul>
      </FloatingPanel>
    </div>
  );
};

// ── التوقيت ──────────────────────────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, step) => String(step * 5).padStart(2, '0'));

export const TimePicker = ({
  rowKey,
  value,
  disabled,
  onChange,
  onSettle,
}: {
  rowKey: string;
  /** «HH:MM», or null. */
  value: string | null;
  disabled: boolean;
  onChange: (next: string | null) => void;
  /**
   * The time is settled — the panel closed, or a typed time was taken. Round 24: the panel's hour
   * and its minute are two clicks but ONE change of the time, and «تراجع» takes them back together;
   * the page merges the clicks into one operation until it is told here.
   */
  onSettle?: () => void;
}): JSX.Element => {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [hour, minute] = (value ?? '').split(':');
  const label = t('operations.crewPlan.columns.time');
  useFocusOnOpen(open, `[data-time-panel="${rowKey}"]`);
  // The panel closing — by a minute, «مسح», Escape, a click outside or the clock again — settles it.
  const settle = useRef(onSettle);
  useEffect(() => {
    settle.current = onSettle;
  });
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) settle.current?.();
    wasOpen.current = open;
  }, [open]);

  const set = (next: string | null): void => {
    if (next !== value) onChange(next);
  };

  return (
    <div ref={box} className="relative w-[5.25rem]" data-time-picker={rowKey}>
      {/* In the page's direction, not `dir="ltr"`: a time reads left to right inside an Arabic line
          on its own, and an LTR box would put its start padding — the clock's room — on the wrong
          side of an Arabic page. */}
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        title={label}
        disabled={disabled}
        placeholder="--:--"
        value={typed ?? value ?? ''}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={() => {
          if (typed === null) return;
          const parsed = parseClock(typed);
          // Something that is not a time is dropped, and the box shows the time it had.
          if (parsed !== undefined) set(parsed);
          setTyped(null);
          onSettle?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'ArrowDown' && event.altKey) setOpen(true);
        }}
        className={cn(CELL_BOX, NUM, 'pe-2 ps-7 tracking-wide')}
      />
      {/* The date box's calendar, as a clock: the cyan icon at the box's start, a button that
          opens the picker. */}
      <button
        type="button"
        data-cell-control="time"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('operations.crewPlan.time.open')}
        title={t('operations.crewPlan.time.open')}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((now) => !now)}
        className="absolute inset-y-0 start-0 flex items-center rounded-s-lg ps-1.5 text-cyan-600 hover:text-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:opacity-40 dark:text-cyan-400"
      >
        <BoardIcon d={PLAN_ICON.clock} className="h-4 w-4" />
      </button>
      <FloatingPanel
        anchor={box}
        open={open}
        onClose={() => setOpen(false)}
        width={248}
        role="dialog"
        aria-label={t('operations.crewPlan.time.open')}
        data-time-panel={rowKey}
        className="p-2"
      >
        <p className="mb-1 text-[11px] font-black text-slate-500 dark:text-slate-400">
          {t('operations.crewPlan.time.hours')}
        </p>
        <div className="grid grid-cols-6 gap-1" dir="ltr" onKeyDown={walk}>
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={h === hour}
              onClick={() => set(`${h}:${minute ?? '00'}`)}
              className={cn(
                'h-6 rounded-md text-[12px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60',
                NUM,
                h === hour
                  ? 'bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950'
                  : 'bg-slate-100 text-slate-700 hover:bg-cyan-500/15 dark:bg-slate-800 dark:text-slate-200',
              )}
            >
              {h}
            </button>
          ))}
        </div>
        <p className="mb-1 mt-2 text-[11px] font-black text-slate-500 dark:text-slate-400">
          {t('operations.crewPlan.time.minutes')}
        </p>
        <div className="grid grid-cols-6 gap-1" dir="ltr" onKeyDown={walk}>
          {MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === minute}
              onClick={() => {
                set(`${hour ?? '08'}:${m}`);
                setOpen(false);
              }}
              className={cn(
                'h-6 rounded-md text-[12px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60',
                NUM,
                m === minute
                  ? 'bg-cyan-600 text-white dark:bg-cyan-500 dark:text-slate-950'
                  : 'bg-slate-100 text-slate-700 hover:bg-cyan-500/15 dark:bg-slate-800 dark:text-slate-200',
              )}
            >
              :{m}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 dark:border-slate-800">
          <span
            dir="ltr"
            className={cn(NUM, 'text-[15px] font-black text-slate-900 dark:text-white')}
          >
            {value ?? '--:--'}
          </span>
          <button
            type="button"
            disabled={value === null}
            onClick={() => {
              set(null);
              setOpen(false);
            }}
            className="rounded-md px-2 py-1 text-[12px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            {t('operations.crewPlan.time.clear')}
          </button>
        </div>
      </FloatingPanel>
    </div>
  );
};

// ── النوع ──────────────────────────────────────────────────────────────────────────────────────

export const ShiftTypePicker = ({
  rowKey,
  value,
  types,
  locale,
  disabled,
  refused,
  onChange,
}: {
  rowKey: string;
  /** The row's type, by id, or null. */
  value: string | null;
  /** The whole catalog, archived types included — so a row's archived type can still be named. */
  types: readonly OperationsShiftTypeDto[];
  locale: Locale;
  disabled: boolean;
  /** The last save refused this row's type (archived on another desk since it was picked). */
  refused?: string | null;
  onChange: (next: string | null) => void;
}): JSX.Element => {
  const t = useT();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useFocusOnOpen(open, `[data-type-list="${rowKey}"]`);
  const choices = shiftTypeChoices(types, value);
  const current = value === null ? undefined : types.find((type) => type.id === value);
  // Archived since the row was given it: still named, and said — the row keeps it.
  const archived = current !== undefined && !current.isActive;
  const name =
    value === null
      ? t('operations.crewPlan.type.choose')
      : current === undefined
        ? '…'
        : shiftTypeName(current, locale);
  const pick = (next: string | null): void => {
    setOpen(false);
    anchor.current?.querySelector('button')?.focus({ preventScroll: true });
    if (next !== value) onChange(next);
  };
  return (
    // The box fills its column as the time's and the notes' do (see the head of this file): one
    // width for every row, whatever the type's name, so the column reads as one straight line. Its
    // chevron sits where the direction box's does, at the same end and height, for the same reason.
    <div ref={anchor} className="relative w-full" data-type-picker={rowKey}>
      <button
        type="button"
        data-cell-control="type"
        data-cell-box="true"
        data-type-archived={archived ? 'true' : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={refused != null ? true : undefined}
        aria-label={`${t('operations.crewPlan.columns.type')}: ${name}`}
        title={
          refused != null
            ? refused
            : archived
              ? `${name} — ${t('operations.crewPlan.type.archivedHint')}`
              : name
        }
        disabled={disabled}
        onClick={() => setOpen((now) => !now)}
        className={cn(
          CELL_BOX,
          // `gap-1.5`, not `gap-1`: the boards' table closes every `gap-1` in a cell to 2px, which
          // set the dot against the name's first letter.
          'flex items-center gap-1.5 pe-6 text-start transition hover:border-brand-400',
          archived && KEPT_BOX,
          refused != null && REFUSED_BOX,
        )}
      >
        {current === undefined ? (
          // «اختر» holds the dot's place, so the names of the column start at one line.
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full border border-dashed border-slate-400 dark:border-slate-500"
          />
        ) : (
          <ShiftTypeDot colour={current.colour} size="sm" />
        )}
        {/* In the board's face for words, Cairo: the boards' cells lead with the figures' mono face,
            whose wide space alone cut «احتياطي سفر» short in a box its letters fit. */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate [font-family:'Cairo',ui-sans-serif,sans-serif]",
            value === null && 'font-semibold text-slate-400 dark:text-slate-500',
          )}
        >
          {name}
        </span>
      </button>
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="pointer-events-none absolute end-1.5 top-2 h-4 w-4 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <FloatingPanel
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        width={256}
        role="listbox"
        aria-label={t('operations.crewPlan.columns.type')}
        data-type-list={rowKey}
        onKeyDown={walk}
      >
        {choices.length === 0 ? (
          <p className="px-2.5 py-2 text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">
            {t('operations.crewPlan.type.empty')}
          </p>
        ) : (
          // Two columns: the catalog's types in one look, in its order, with no scrolling.
          <div className="grid grid-cols-2 gap-0.5">
            {choices.map((type) => (
              <button
                key={type.id}
                type="button"
                role="option"
                data-type-option={type.id}
                aria-selected={type.id === value}
                title={
                  type.isActive
                    ? undefined
                    : `${shiftTypeName(type, locale)} — ${t('operations.crewPlan.type.archivedHint')}`
                }
                onClick={() => pick(type.id)}
                className={cn(
                  OPTION,
                  'min-w-0 px-1.5',
                  type.id === value && 'bg-slate-100 dark:bg-slate-800/80',
                )}
              >
                <ShiftTypeTag type={type} locale={locale} className="max-w-full" />
                {!type.isActive && (
                  <span className="shrink-0 text-[10.5px] font-black text-amber-700 dark:text-amber-300">
                    {t('operations.crewPlan.type.archived')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          role="option"
          aria-selected={value === null}
          onClick={() => pick(null)}
          className={cn(
            OPTION,
            'mt-1 justify-center border-t border-slate-100 text-[12.5px] text-slate-500 dark:border-slate-800 dark:text-slate-400',
          )}
        >
          {t('operations.crewPlan.type.clear')}
        </button>
      </FloatingPanel>
    </div>
  );
};

// ── The row's colour ─────────────────────────────────────────────────────────────────────────────

/**
 * The «اللون» cell — Round 24b, «تلقائي ويتغيّر يدوي»: a row wears its TYPE's colour by itself, and a
 * colour picked here overrides it. The list offers exactly the palette shown on the board — as many
 * swatches as there are live types (`rowColourChoices`), each naming the types that wear it — and
 * «لون النوع», which takes the override off. The row's own colour, when it is no longer among those
 * swatches (the type that wore it archived or recoloured), is still offered at the end, pressed,
 * «outside the palette».
 *
 * The button shows the colour the row is drawn in: the override solid; the type's in a dashed ring
 * («automatic»); none, the drop. The keyboard walks the swatches by the arrows (a grid, in the
 * reading direction), Enter picks, Escape closes.
 */
export const RowColourPicker = ({
  rowKey,
  value,
  typeColour,
  choices,
  wornBy,
  catalog,
  onRetry,
  disabled,
  onChange,
}: {
  rowKey: string;
  /** The colour picked by hand on the row, or null — «لون النوع». */
  value: CrewRowColour | null;
  /** The row's type's colour, or null (no type yet). */
  typeColour: CrewRowColour | null;
  /** What the list offers (`rowColourChoices`). */
  choices: readonly RowColourChoice[];
  /** The live types wearing a colour, by name — a swatch's tooltip. */
  wornBy: (colour: CrewRowColour) => readonly string[];
  /** The types' read, which the palette is built from (`catalogStateOf`). */
  catalog: CatalogState;
  /** Read the types again — after a failed read. */
  onRetry: () => void;
  disabled: boolean;
  onChange: (next: CrewRowColour | null) => void;
}): JSX.Element => {
  const t = useT();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useFocusOnOpen(open, `[data-colour-panel="${rowKey}"]`);
  const pick = (next: CrewRowColour | null): void => {
    setOpen(false);
    anchor.current?.querySelector('button')?.focus({ preventScroll: true });
    if (next !== value) onChange(next);
  };
  const shown = value ?? typeColour;
  const name =
    value !== null
      ? t(`operations.catalogs.shiftType.colours.${value}`)
      : typeColour !== null
        ? t('operations.crewPlan.colour.autoOf', {
            colour: t(`operations.catalogs.shiftType.colours.${typeColour}`),
          })
        : t('operations.crewPlan.colour.none');
  return (
    <div ref={anchor} className="inline-block" data-colour-picker={rowKey}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('operations.crewPlan.colour.open')}: ${name}`}
        title={`${t('operations.crewPlan.colour.open')}: ${name}`}
        data-colour-source={value !== null ? 'row' : typeColour !== null ? 'type' : 'none'}
        disabled={disabled}
        onClick={() => setOpen((now) => !now)}
        className="flex items-center justify-center rounded-lg border border-slate-200 bg-white transition hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0a1233]"
      >
        {shown === null ? (
          <BoardIcon d={PLAN_ICON.drop} className="h-4 w-4 text-slate-400" />
        ) : (
          <span
            aria-hidden
            data-colour-shown={shown}
            className={cn(
              'h-4 w-4 rounded-full',
              SHIFT_TYPE_TONE[shown].dot,
              value !== null
                ? 'ring-2 ring-white/80 dark:ring-slate-900'
                : // The type's colour, by itself: a dashed ring says nobody picked it here.
                  'outline-dashed outline-2 outline-offset-1 outline-slate-500 dark:outline-slate-300',
            )}
          />
        )}
      </button>
      <FloatingPanel
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        width={236}
        role="dialog"
        aria-label={t('operations.crewPlan.colour.open')}
        data-colour-panel={rowKey}
        className="p-2.5"
      >
        <RowColourSwatches
          value={value}
          typeColour={typeColour}
          choices={choices}
          wornBy={wornBy}
          catalog={catalog}
          onRetry={onRetry}
          onPick={pick}
        />
      </FloatingPanel>
    </div>
  );
};

/** The swatches a line of the «اللون» list holds. */
const COLOUR_COLUMNS = 6;

/**
 * The «اللون» list itself: the palette shown (each swatch naming the types that wear it), the row's
 * own colour after it when outside it, and «لون النوع». Pressed: the colour picked on the row; dashed:
 * the type's, while nothing is picked. Until the types have answered (`catalog`), it says they are
 * loading, or that the read failed with «إعادة المحاولة» — never «no active types».
 */
export const RowColourSwatches = ({
  value,
  typeColour,
  choices,
  wornBy,
  catalog = 'ready',
  onRetry,
  onPick,
}: {
  value: CrewRowColour | null;
  typeColour: CrewRowColour | null;
  choices: readonly RowColourChoice[];
  wornBy: (colour: CrewRowColour) => readonly string[];
  catalog?: CatalogState;
  onRetry?: () => void;
  onPick: (next: CrewRowColour | null) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const colourName = (colour: CrewRowColour): string =>
    t(`operations.catalogs.shiftType.colours.${colour}`);
  const swatchWords = ({ colour, outside }: RowColourChoice): string => {
    if (outside) return t('operations.crewPlan.colour.outside', { colour: colourName(colour) });
    const types = wornBy(colour);
    return types.length === 0
      ? t('operations.crewPlan.colour.unworn', { colour: colourName(colour) })
      : t('operations.crewPlan.colour.wornBy', {
          colour: colourName(colour),
          types: types.join('، '),
        });
  };
  const palette = choices.filter((choice) => !choice.outside).length;
  /** The swatches' grid: ←/→ along a line in the reading direction, ↑/↓ a line, Home / End. */
  const walkGrid = (event: KeyboardEvent<HTMLElement>): void => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-colour]'),
    );
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const next = gridStep(event.key, at, buttons.length, COLOUR_COLUMNS, rtl);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };
  return (
    <>
      {catalog === 'ready' && (
        <p className="mb-2 text-[11px] font-black text-slate-500 dark:text-slate-400">
          {t('operations.crewPlan.colour.palette', { count: formatNumber(palette, locale) })}
        </p>
      )}
      {catalog === 'loading' ? (
        <p
          role="status"
          data-colour-catalog="loading"
          className="mb-1 flex items-center gap-2 text-[12px] font-bold text-slate-500 dark:text-slate-400"
        >
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          {t('operations.crewPlan.colour.loading')}
        </p>
      ) : catalog === 'failed' ? (
        <div role="alert" data-colour-catalog="failed" className="mb-1 space-y-1.5">
          <p className="text-[12px] font-bold text-rose-700 dark:text-rose-300">
            {t('operations.crewPlan.colour.failed')}
          </p>
          {onRetry !== undefined && (
            <button
              type="button"
              data-colour-retry="true"
              onClick={onRetry}
              className="rounded-md border border-slate-300 px-2 py-1 text-[12px] font-bold text-slate-700 transition hover:border-brand-400 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-slate-600 dark:text-slate-200 dark:hover:text-brand-200"
            >
              {t('common.retry')}
            </button>
          )}
        </div>
      ) : choices.length === 0 ? (
        <p className="mb-1 text-[12px] font-bold text-slate-500 dark:text-slate-400">
          {t('operations.crewPlan.colour.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-6 gap-1.5" data-colour-grid="true" onKeyDown={walkGrid}>
          {choices.map((choice) => {
            const { colour, outside } = choice;
            const on = colour === value;
            const automatic = value === null && colour === typeColour;
            return (
              <button
                key={`${colour}${outside ? ':outside' : ''}`}
                type="button"
                data-colour={colour}
                data-colour-outside={outside ? 'true' : undefined}
                data-colour-type={automatic ? 'true' : undefined}
                aria-pressed={on}
                aria-label={swatchWords(choice)}
                title={swatchWords(choice)}
                onClick={() => onPick(colour)}
                className={cn(
                  'h-7 w-7 rounded-full transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111827]',
                  SHIFT_TYPE_TONE[colour].dot,
                  on &&
                    'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-[#111827]',
                  // The type's own colour while nobody picked one here — dashed, as on the button.
                  automatic &&
                    'outline-dashed outline-2 outline-offset-2 outline-slate-500 dark:outline-slate-300',
                  outside && 'border-2 border-dashed border-white dark:border-slate-900',
                )}
              />
            );
          })}
        </div>
      )}
      <button
        type="button"
        data-colour="type"
        aria-pressed={value === null}
        title={t('operations.crewPlan.colour.autoHint')}
        onClick={() => onPick(null)}
        className={cn(
          OPTION,
          'mt-2 justify-center border border-dashed border-slate-300 text-[12.5px] text-slate-600 dark:border-slate-600 dark:text-slate-300',
          value === null && 'border-solid border-brand-400 bg-brand-500/10',
        )}
      >
        {typeColour === null ? (
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-full border border-dashed border-slate-400"
          />
        ) : (
          <ShiftTypeDot colour={typeColour} size="sm" />
        )}
        <span className="min-w-0 truncate">
          {t('operations.crewPlan.colour.auto')}
          {typeColour === null && (
            <span className="ms-1 font-semibold text-slate-400 dark:text-slate-500">
              ({t('operations.crewPlan.colour.noType')})
            </span>
          )}
        </span>
      </button>
    </>
  );
};

// ── A vehicle-less row's van ─────────────────────────────────────────────────────────────────────

/**
 * The «بدون سيارة» cell of a row without a van — the button that opens the cars it may take. Round
 * 24: the list is the page's (`CrewVehiclePicker` — every car with no crew that day, the phone's
 * bottom sheet included), as a slot's list is; this is only what opens it.
 */
export const VanPicker = ({
  rowKey,
  open,
  disabled,
  refused,
  onOpen,
}: {
  rowKey: string;
  /** Its list is open now. */
  open: boolean;
  disabled: boolean;
  /** What the last save said about the van given to this row, or null. */
  refused?: string | null;
  onOpen: (from: HTMLElement) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="inline-block" data-van-picker={rowKey}>
      {/* The row's «بدون سيارة» IS the button that gives it one — one element in a narrow column,
          where a label and a button beside it widened the whole table. */}
      <button
        type="button"
        data-cell-control="van"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('operations.crewPlan.noVehicle')} — ${t('operations.crewPlan.pickVehicle')}`}
        title={refused ?? t('operations.crewPlan.pickVehicle')}
        disabled={disabled}
        onClick={(event) => onOpen(event.currentTarget)}
        // Two short lines in the van column's width: «بدون / سيارة» beside a three-digit code.
        className={cn(
          'flex max-w-[3.5rem] flex-col items-center whitespace-normal rounded-md border border-dashed border-slate-300 px-1 py-0.5 text-center text-[11px] font-bold leading-[1.15] text-slate-600 transition hover:border-brand-400 hover:bg-brand-500/10 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-default disabled:hover:border-slate-300 disabled:hover:bg-transparent dark:border-slate-600 dark:text-slate-300 dark:hover:text-brand-200',
          open && 'border-brand-400 bg-brand-500/15 text-brand-700 dark:text-brand-200',
          refused != null && REFUSED_BOX,
        )}
      >
        <BoardIcon d={PLAN_ICON.noVan} className="h-3 w-3 shrink-0" />
        {t('operations.crewPlan.noVehicle')}
      </button>
    </div>
  );
};
