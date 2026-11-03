// A filter dropdown that takes MORE THAN ONE answer.
//
// A queue filter is a question like "which statuses am I looking at?", and the honest answer is
// usually several — "waiting and accepted, not rejected". A single-value `<select>` forces that
// question to be asked one answer at a time, so the user filters, reads, changes the filter, and
// reads again, holding the comparison in their head. Checkboxes let them ask it once.
//
// Two details carry most of the usefulness:
//  • The trigger shows HOW MANY are selected, so a filtered list never looks like an unfiltered one.
//    A filter you have forgotten you set is worse than no filter.
//  • The list is searchable and folds Arabic spelling, because a stage or branch list gets long and
//    scrolling to find one entry is slower than typing three letters of it.
import { useEffect, useId, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { type ControlDensity } from './form';
import { foldIncludes } from '../lib/fold';
import { useOnClickOutside } from '../lib/useOnClickOutside';
import { useT } from '../../platform/localization/useT';
import { CheckIcon, ChevronIcon, CloseIcon, SearchIcon } from './icons';
import { useFieldMissing } from './required-fields';

/** Names shown in full before the tail collapses to `+n`. Three fit a filter-bar trigger. */
const SUMMARY_MAX = 3;

export interface MultiSelectOption {
  value: string;
  label: string;
  /**
   * A shorter form for the TRIGGER, when the list label is too long to sit in a filter bar.
   *
   * Optional and falling back to `label`, so a caller that has nothing shorter to say says
   * nothing. A vehicle reads as "150 — س ص 150" in the list, where the plate confirms the car,
   * but the trigger has one row to work with and the code alone identifies it.
   */
  shortLabel?: string;
}

/**
 * What the trigger says once something is chosen: the choices themselves, not how many.
 *
 * A count answers "is this filtered?" and leaves "filtered to WHAT?" to a click. Naming the
 * choices answers both. Past `max` the tail collapses to `+n` — the row cannot grow, and two
 * names plus a number still say more than a bare count does.
 *
 * Values are shown in the order they were CHOSEN, not the order the options happen to arrive in:
 * a server-backed list reorders under the reader, and a summary that reshuffles itself while they
 * read it is worse than one that is merely long.
 */
/**
 * What ONE chosen value is called.
 *
 * The trigger's summary and the panel's chips both answer this, and they must answer it the same
 * way: the chips used to print the value itself, which is right only where the value IS its own
 * label. A vehicle code is; an employee id is not, so a bar naming «محمد حاتم» in the list showed
 * «6a9c87ff7ae99d20407ded49» on the chip beside it. One function, so the two cannot drift again.
 *
 * A chosen value the current options do not carry — a server-backed list has moved on — is still
 * named by the only thing known about it, which is the value.
 */
export const optionLabel = (options: readonly MultiSelectOption[], value: string): string => {
  const option = options.find((o) => o.value === value);
  return option?.shortLabel ?? option?.label ?? value;
};

export const selectionSummary = (
  options: readonly MultiSelectOption[],
  value: readonly string[],
  max: number,
): string => {
  const shown = (v: string): string => optionLabel(options, v);
  // An ASCII comma rather than an Arabic one: the trigger is not branched by locale, and it
  // carries Latin identifiers as often as Arabic words. The codebase uses both — `، ` for prose
  // lists, `, ` for lists of values — and this is the second kind.
  if (value.length <= max) return value.map(shown).join(', ');
  // Two names plus the remainder: enough to recognise the filter, short enough to fit.
  const head = value
    .slice(0, max - 1)
    .map(shown)
    .join(', ');
  return `${head} +${value.length - (max - 1)}`;
};

/**
 * Where the keyboard's highlight goes next — «الموشر فى الفلاتر كلها لما اجى انزل بالسعم ل تحت
 * مش بينول عشان اختار».
 *
 * The highlight is held as a VALUE, not a row number: a list that puts the picked values first
 * (the car and driver filters do) reorders under it on every pick, and a row number would then
 * point at a different option than the one the reader was on. A value that has left the list —
 * typed away — is as good as none, so the next step starts again from the top (or the bottom).
 * Wraps at both ends, as `Combobox` does.
 */
export const nextActiveOption = (
  options: readonly MultiSelectOption[],
  active: string | null,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
): string | null => {
  if (options.length === 0) return null;
  const last = options.length - 1;
  const at = active === null ? -1 : options.findIndex((o) => o.value === active);
  let next: number;
  if (key === 'Home') next = 0;
  else if (key === 'End') next = last;
  else if (key === 'ArrowDown') next = at === -1 || at === last ? 0 : at + 1;
  else next = at <= 0 ? last : at - 1;
  return options[next]?.value ?? null;
};

/**
 * What a key pressed anywhere inside the control does. Apart from the DOM so the suite, which has
 * none, can hold it to the request.
 *
 * Enter picks the highlighted option, and only when one IS highlighted: with nothing highlighted
 * it keeps the meaning it always had — the car filter's search box takes the typed codes, the
 * trigger opens and closes. Home/End move the caret while the search box has focus, so they move
 * the highlight only from elsewhere.
 *
 * An arrow opens the list from the TRIGGER only. On the closed list's ✕ it would open a list too
 * short for a search box with the focus still on the ✕ — and the Enter meant for the highlighted
 * option would press the ✕ and clear every pick.
 */
export const multiSelectKey = (
  key: string,
  {
    open,
    highlighted,
    from,
  }: { open: boolean; highlighted: boolean; from: 'search' | 'trigger' | 'other' },
): 'open' | 'move' | 'pick' | 'close' | null => {
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (open) return 'move';
    return from === 'trigger' ? 'open' : null;
  }
  if ((key === 'Home' || key === 'End') && open && from !== 'search') return 'move';
  if (key === 'Enter' && open && highlighted && from !== 'other') return 'pick';
  if (key === 'Escape' && open) return 'close';
  return null;
};

/**
 * What an EMPTY list says. Loading while the answer is on its way; otherwise the owner's own words
 * when it has them — a list that could not be READ must not claim that nothing matched — and «no
 * results» when it does not.
 */
export const emptyListText = (
  t: (key: string) => string,
  { searching, emptyText }: { searching: boolean; emptyText?: string | undefined },
): string => (searching ? t('common.loading') : (emptyText ?? t('common.noResults')));

/**
 * Pure: the picks after «every match» (`pickMatches`) — the matches not yet picked added after the
 * picks, in the list's order; or, with `drop`, exactly the matches taken out and every other pick
 * kept.
 */
export const withAllMatches = (
  value: readonly string[],
  matches: readonly string[],
  drop: boolean,
): string[] => {
  if (drop) {
    const found = new Set(matches);
    return value.filter((v) => !found.has(v));
  }
  const had = new Set(value);
  return [...value, ...matches.filter((m) => !had.has(m))];
};

/** Does `later` come after `earlier` in the document? */
const followsInDocument = (earlier: Node, later: Node): boolean =>
  earlier !== later &&
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
  !earlier.contains(later);

/** The controls of a floating panel that Tab stops at, in order — its options are not among them. */
const panelTabStops = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>('input, button, [tabindex]')].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled,
  );

/** Where a floating panel sits, in the viewport's terms (`floating`). */
export interface FloatingSpot {
  left: number;
  /** Below the trigger: its top edge. */
  top: number;
  /** Above the trigger: its bottom edge, from the viewport's bottom. */
  bottom: number;
  maxHeight: number;
  below: boolean;
}

/** The panel's tallest — `max-h-72`, as the panel that does not float. */
const PANEL_MAX = 288;

/**
 * Pure: where a floating panel goes for a trigger at `trigger` in a viewport of `viewport`.
 * Along the text from the trigger's start edge, as the panel that does not float, but never past
 * either side of the screen; below the trigger unless there is more room above and the list
 * does not fit below; as tall as the room on its side allows, up to the usual height.
 */
export const floatingSpot = (
  trigger: { top: number; bottom: number; left: number; right: number },
  width: number,
  viewport: { width: number; height: number; rtl: boolean },
): FloatingSpot => {
  const gap = 4;
  const edge = 8;
  const start = viewport.rtl ? trigger.right - width : trigger.left;
  const left = Math.max(edge, Math.min(start, viewport.width - width - edge));
  const roomBelow = viewport.height - trigger.bottom - gap - edge;
  const roomAbove = trigger.top - gap - edge;
  const below = roomBelow >= PANEL_MAX || roomBelow >= roomAbove;
  return {
    left,
    top: trigger.bottom + gap,
    bottom: viewport.height - trigger.top + gap,
    maxHeight: Math.max(96, Math.min(PANEL_MAX, below ? roomBelow : roomAbove)),
    below,
  };
};

/** The boxes that clip an element: every ancestor whose overflow is not `visible`. */
const scrollBoxes = (element: HTMLElement): DOMRect[] => {
  const boxes: DOMRect[] = [];
  for (let at = element.parentElement; at !== null && at !== document.body; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (`${style.overflowX} ${style.overflowY}` !== 'visible visible') {
      boxes.push(at.getBoundingClientRect());
    }
  }
  return boxes;
};

/**
 * Pure: can the reader still see the trigger — is its middle inside the screen and inside every
 * box that clips it? A floating panel whose trigger has scrolled away closes (`floating`).
 */
export const triggerInSight = (
  trigger: { top: number; bottom: number; left: number; right: number },
  clips: readonly { top: number; bottom: number; left: number; right: number }[],
  width: number,
  height: number,
): boolean => {
  const x = (trigger.left + trigger.right) / 2;
  const y = (trigger.top + trigger.bottom) / 2;
  return [{ top: 0, bottom: height, left: 0, right: width }, ...clips].every(
    (box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom,
  );
};

const sameSpot = (a: FloatingSpot | null, b: FloatingSpot): boolean =>
  a !== null &&
  a.left === b.left &&
  a.top === b.top &&
  a.bottom === b.bottom &&
  a.maxHeight === b.maxHeight &&
  a.below === b.below;

export const MultiSelect = ({
  label,
  options,
  value,
  onChange,
  /** Show the search box only when the list is long enough for it to earn its space. */
  searchThreshold = 7,
  onSearch,
  onCommitSearch,
  searchValue,
  searching = false,
  emptyText,
  statusText,
  showSelectedValues = false,
  chips = false,
  density = 'default',
  placeholder,
  fullWidth = false,
  clearSearchOnPick = false,
  panelWidth,
  clearable = false,
  floating = false,
  pickMatches = false,
  match,
  onOpen,
  loadOptions,
  size = 'default',
  className,
}: {
  /** What the filter asks. Shown in the trigger while nothing is selected. */
  label: string;
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  searchThreshold?: number;
  /**
   * Hand the typed query to the OWNER of the options instead of filtering here.
   *
   * A list short enough to hold in the page is filtered locally, which is the default. A list
   * that outgrows one page — a vehicle registry, a branch directory — cannot be: filtering what
   * happens to have been fetched silently answers "which of the first N" instead of "which".
   * When this is given, `options` are taken as the answer already and the search box is always
   * offered, however few of them came back.
   */
  onSearch?: (query: string) => void;
  /**
   * Enter pressed in the search box, with whatever is typed there.
   *
   * For a filter whose values can be WRITTEN as well as picked — a list of vehicle codes pasted
   * out of a message. The owner decides what the text means and calls `onChange`; this only says
   * when. Opt-in: without it, Enter does what it always did.
   */
  onCommitSearch?: (raw: string) => void;
  /**
   * Take ownership of the search text.
   *
   * For a filter whose box is also an INPUT: the owner may consume part of what was typed — turning
   * `150 - 215` into a chosen `150` and a still-being-typed `215` — and it can only show that by
   * putting the remainder back. Omit it and the box keeps its own text, as every other filter does.
   */
  searchValue?: string;
  /**
   * The answer is on its way — the remote search's, alongside `onSearch`, or the options' own
   * first read. An empty list then says it is loading rather than that nothing matched.
   */
  searching?: boolean;
  /**
   * What the empty list says instead of «no results», when that would not be true — the options
   * could not be read, so nothing is known about what matches. Opt-in; see `emptyListText`.
   */
  emptyText?: string;
  /**
   * A line above the options while they are not the whole answer — still loading, or could not be
   * read — for a list that keeps showing what is already CHOSEN meanwhile. Its matches are then
   * never empty, so the empty list's own words would never be seen. Opt-in.
   */
  statusText?: string;
  /**
   * How much room the TRIGGER spends on itself — the same opt-in `Input` and `Select` take.
   *
   * A filter bar that puts this control next to ten selects needs all eleven to read as one row of
   * one kind of thing. At the default the trigger spends wider gutters than its neighbours do at
   * `tight`, which on a crowded bar showed as one odd control whose own name was the only one
   * clipped. Only the gutters change — see the trigger's own note on why the type size may not.
   */
  density?: ControlDensity;
  /**
   * Name the chosen values in the trigger instead of counting them.
   *
   * Off by default: a filter over a short, familiar vocabulary — a handful of statuses — is
   * legible as a count, and every bar that reads that way today keeps reading that way. Turn it
   * on where the vocabulary is open or unmemorable, and the reader would otherwise have to open
   * the list to find out what they had already chosen.
   */
  showSelectedValues?: boolean;
  /**
   * What the EMPTY trigger says, when the label is already written above the control.
   *
   * A filter bar has no labels, so the trigger carries the question and this stays unset — every
   * bar in the system reads exactly as it did. A form field has a `<label>` above it, and
   * repeating the same words inside the control says nothing twice. `label` still answers the
   * screen reader either way.
   */
  /**
   * Show the selection as removable chips at the top of the panel.
   *
   * Off by default, so the filters that read as a count keep reading as one. A filter whose values
   * are individually meaningful — which CARS — needs them nameable and removable one at a time,
   * and the panel is where a reader is already looking when they manage a selection. Putting them
   * under the trigger instead would push every filter bar that hosts one out of shape.
   */
  chips?: boolean;
  placeholder?: string;
  /**
   * Fill the width this control was GIVEN, instead of sizing to its own contents.
   *
   * The trigger is an `inline-flex`, so in a filter bar that hands every field an equal share of
   * the row it shrank to the width of the word «الكل» while the `<select>` and `<input>` beside
   * it filled theirs — four controls in four different widths under four equally-sized labels,
   * which is what «شكل الفلاتر بايظ» was. Off by default, so every bar that sizes this control by
   * its contents keeps reading exactly as it does today.
   */
  fullWidth?: boolean;
  /**
   * Empty the search box the moment an option is picked — «لما اكون بكتب حاجه فى السيرش ...
   * اول ما اختار يمسح اللى فى السيرش». Off by default; a list searched to pick one thing at a time
   * (spare parts) turns it on, so the next part is typed into a clean box.
   */
  clearSearchOnPick?: boolean;
  /**
   * The drop-down's width, when the default is too narrow for what it lists — a driver's full
   * name with their code beside it. A Tailwind width class.
   */
  panelWidth?: string;
  /**
   * «اعملى اوبشن ان يكون في حاجة ادوس عليها امسح اللى اختارته كله». A ✕ beside the CLOSED trigger
   * that clears every pick in one press, shown once something is picked — and the panel's own
   * «مسح الكل» row pinned under the list, where a long list can no longer scroll it out of the
   * panel. Opt-in so the screens that have not asked for it look exactly as they did; Fleet turns
   * it on for every multi-pick (`fleet-multi-clear.spec.ts`).
   */
  clearable?: boolean;
  /**
   * The list opens in a layer of its own over the page, fixed under (or above) the trigger,
   * instead of inside the control's box. For a control that sits INSIDE a scrolling container —
   * a table's filter row, «الفلتر الكبير اللى فوق الجداول يكون Drop Down بـ Multi select» — whose
   * edge would otherwise cut the list off, or make the reader scroll the table to reach it. It
   * follows the trigger while the page or the table scrolls. Off by default: a filter bar's list
   * opens where it always did.
   */
  floating?: boolean;
  /**
   * While something is typed in the search box, a row above the matches picks them ALL — or, when
   * all are picked, drops them all — and Enter with no option highlighted picks them too. For a
   * long list of values where the reader means «every one holding 704», as a sheet's own filter
   * takes what its search box found: a table's column filter, which used to be a box typed into.
   * Opt-in, and only for a list searched here (not `onSearch`).
   */
  pickMatches?: boolean;
  /**
   * How the search box matches an option's label, when the app's own rule (`foldIncludes`, which
   * drops punctuation) would match too much: a table's column filter lists dates and times, and
   * «2/11» must not find 21/10. Opt-in; a list searched by its owner (`onSearch`) ignores it.
   */
  match?: (label: string, query: string) => boolean;
  /**
   * Called as the list OPENS — by a click on the trigger or an arrow key — before the reader picks
   * anything. A table's area filter clears its picks here, so each opening starts over (2026-11-03,
   * «لما أضغط على فلتر (المنطقة فقط) يعمله Reset وأقدر أختار من الأول»). Opt-in.
   */
  onOpen?: () => void;
  /**
   * The list, asked for only while it is OPEN — `options` then needs to name the chosen values
   * only, for the closed trigger. For a list that is costly to make and seldom looked at: a
   * table's filter row has one per column, made from every row, on a board that re-renders every
   * second for its timers.
   */
  loadOptions?: () => readonly MultiSelectOption[];
  /**
   * `sm`: a shorter trigger in smaller type, for a row where every control is one of these — a
   * table's filter row under its head, where a filter-bar trigger would make the head a line
   * taller than the rows it labels. Not for a bar that mixes this with `Input` or `Select`: see
   * the trigger's note on why one row of controls must be one height.
   */
  size?: 'default' | 'sm';
  className?: string;
}): JSX.Element => {
  const t = useT();
  // A `Field` marked missing turns this trigger red, as it does an `Input`.
  const missing = useFieldMissing();
  const [open, setOpen] = useState(false);
  const [ownQuery, setOwnQuery] = useState('');
  // Controlled when the owner passes `searchValue`; its own otherwise.
  const query = searchValue ?? ownQuery;
  const setQuery = (next: string): void => {
    if (searchValue === undefined) setOwnQuery(next);
  };
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  // The option the KEYBOARD is on — by value, see `nextActiveOption`. A tint, never the purple of a
  // pick: what is highlighted is where Enter will land, not something chosen.
  const [active, setActive] = useState<string | null>(null);
  // Opened from the keyboard: the highlight waits on the first (or last) row of the list as it is
  // DRAWN, not as it was when the key landed — the car and driver filters search for themselves,
  // and the list they still hold then is the last search's, not the fresh one opening asks for.
  const [edge, setEdge] = useState<'ArrowDown' | 'ArrowUp' | null>(null);
  // Counts what the KEYS do to the highlight; the list scrolls to it on a key and on nothing else.
  const [steps, setSteps] = useState(0);
  // The panel is not inside the box once it floats (`floating`): a press on it is still inside.
  const panelRef = useRef<HTMLDivElement>(null);
  const insideRefs = useMemo(() => [boxRef, panelRef], []);
  useOnClickOutside(insideRefs, () => setOpen(false), open);
  // «لما بفتح دى بتفتح برا الشاشه»: a list wider than its trigger opens toward the page's edge
  // when the trigger sits at that edge — the last filter of a bar. Measured once open, it is
  // pinned to the trigger's other side instead, so it opens back into the screen.
  const [pin, setPin] = useState<'left' | 'right' | null>(null);
  useLayoutEffect(() => {
    if (!open || floating) {
      setPin(null);
      return undefined;
    }
    // Measured from the TRIGGER, whose place does not depend on the pin — so it can be measured
    // again (a resize, a trigger that grew with its picks) without a reset-then-measure cycle.
    const place = (): void => {
      const box = boxRef.current;
      const panel = panelRef.current;
      if (box === null || panel === null) return;
      const trigger = box.getBoundingClientRect();
      const width = panel.offsetWidth;
      // Where the panel would sit unpinned: from the trigger's start edge, along the text.
      const rtl = getComputedStyle(box).direction === 'rtl';
      const left = rtl ? trigger.right - width : trigger.left;
      const next = left < 8 ? 'left' : left + width > window.innerWidth - 8 ? 'right' : null;
      // On the panel at once, not only on the next render: the search box is focused and the list
      // revealed in this same commit (below), and must find the list where it will stay.
      panel.style.left = next === 'left' ? '0px' : next === 'right' ? 'auto' : '';
      panel.style.right = next === 'right' ? '0px' : next === 'left' ? 'auto' : '';
      setPin(next);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, value.length, floating]);

  // Where a FLOATING panel sits: fixed to the trigger, in the viewport's terms. Below it when the
  // list fits there or there is more room below than above; above it otherwise, its bottom on the
  // trigger's top, so a list that shrinks as it is searched stays against the trigger.
  //
  // Measured after every render (the trigger moves when the rows it filters change the columns'
  // widths), but the state is SET only when the spot really changes — through a ref, never a
  // same-value `setSpot`: React cannot drop that cheaply right after the control's own update, and
  // would render every MultiSelect in the app twice for each key.
  const [spot, setSpot] = useState<FloatingSpot | null>(null);
  const spotRef = useRef<FloatingSpot | null>(null);
  // Has this opening been placed once? Its first pass brings the trigger into sight instead.
  const placedRef = useRef(false);
  useLayoutEffect(() => {
    if (!open || !floating) {
      placedRef.current = false;
      if (spotRef.current !== null) {
        spotRef.current = null;
        setSpot(null);
      }
      return undefined;
    }
    if (!placedRef.current) {
      // Opened from a trigger half scrolled past its table's edge — the reader clicked the half
      // they could see: the table turns just enough to show it whole, rather than the list
      // closing on its first measure as "out of sight" before it was ever drawn.
      placedRef.current = true;
      boxRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    const place = (): void => {
      const box = boxRef.current;
      const panel = panelRef.current;
      if (box === null || panel === null) return;
      const trigger = box.getBoundingClientRect();
      // A trigger scrolled out of sight — the table turned sideways, the page scrolled under its
      // top bar — takes its list with it, rather than leave it hanging over whatever is there.
      if (!triggerInSight(trigger, scrollBoxes(box), window.innerWidth, window.innerHeight)) {
        setOpen(false);
        return;
      }
      const next = floatingSpot(trigger, panel.offsetWidth, {
        width: window.innerWidth,
        height: window.innerHeight,
        rtl: getComputedStyle(box).direction === 'rtl',
      });
      if (sameSpot(spotRef.current, next)) return;
      spotRef.current = next;
      setSpot(next);
    };
    place();
    // `capture`: the table's own scroll does not bubble to the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });

  // A list made only when open (`loadOptions`): closed, `options` names the chosen values. Made
  // ONCE per opening and per pick — not on every render: a board re-renders every second, and an
  // arrow key or a typed letter re-renders the control, while a column's list of 1,500 rows takes a
  // tenth of a second to make. So the list is a SNAPSHOT, taken at the opening and at each pick:
  // a refetch while it is open (preparation and control poll every minute) reaches it on the next
  // pick or the next opening.
  const pickedKey = value.join('\u0000');
  const loaded = useMemo(
    () => (open && loadOptions !== undefined ? loadOptions() : null),
    // Not `loadOptions` itself: it is a new function on every render (see above).
    [open, pickedKey, loadOptions === undefined],
  );
  const listed = loaded ?? options;
  const remote = onSearch !== undefined;
  const searchable = remote || listed.length >= searchThreshold;
  // The search box takes the caret once the list is OPEN AND PLACED — never `autoFocus`.
  // «لما بضغط عليه المنيو بيطلع شمال برا الشاشة وبيغير الـ UI» (2026-11-03): `autoFocus` focused the
  // box on the render that drew the list, before the pin (above) moved a list at the page's left
  // edge back into the screen; the browser scrolled the board sideways to show the box where it
  // first stood, the pin then moved the list, and the page was left shifted. This runs after the
  // pin's own effect, which has already put the list in place: the box is focused without
  // scrolling, and the list — now inside the screen — is brought into view only as much as it
  // needs, which is down (a list opened low in a dialog), never sideways. A floating list is fixed
  // to the trigger and needs neither.
  useLayoutEffect(() => {
    if (!open || !searchable) return;
    searchRef.current?.focus({ preventScroll: true });
    if (!floating) panelRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [open, searchable, floating]);
  const matches = useMemo(
    () =>
      !remote && searchable && query !== ''
        ? listed.filter((o) => (match ?? foldIncludes)(o.label, query))
        : listed,
    [listed, query, searchable, remote, match],
  );

  const current = active ?? (edge === null ? null : nextActiveOption(matches, null, edge));
  const activeIndex = current === null ? -1 : matches.findIndex((o) => o.value === current);
  const optionId = (index: number): string => `${listId}-option-${index}`;
  // Keep the highlighted row inside the list's scroll port while arrowing through a long list.
  // Keyed on the KEY, not the row: a pick by mouse in a list that puts the picked first moves the
  // highlighted row as well, and following it would scroll the list out from under the pointer.
  useEffect(() => {
    if (steps === 0) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [steps]);

  /** A new search — typed, cleared, or asked afresh on opening — starts the highlight over. */
  const searchFor = (next: string): void => {
    setQuery(next);
    onSearch?.(next);
    setActive(null);
    setEdge(null);
  };

  const selected = value.length;
  // `null` = say the label, the way every bar that has not opted in still does.
  const summary =
    showSelectedValues && selected > 0 ? selectionSummary(options, value, SUMMARY_MAX) : null;
  const toggle = (option: string): void => {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
    if (clearSearchOnPick && query !== '') searchFor('');
    // «لما بختار حاجه وتتمسح بحتاج ارجع المؤشر تانى عشان اكتب لا انا عاوز المؤسر يفضل موجود»: the
    // caret stays in the search box after a pick, so the next one is typed straight away. The
    // options keep it there by refusing focus on press; this covers a pick from anywhere else.
    searchRef.current?.focus();
  };

  // `pickMatches`: the row over the matches, shown while the search narrows a list searched here.
  // Only while the search LOOKS for something — a letter or a digit. A lone «/» or «—» matches
  // every option, and «every match» would then pick the whole list.
  const matchesRow = pickMatches && !remote && /[\p{L}\p{N}]/u.test(query) && matches.length > 0;
  const allMatchesPicked = matchesRow && matches.every((o) => value.includes(o.value));
  // What «every match» just did, for a screen reader: the row is no option the arrows reach, and
  // Enter in the search box picks without moving anything a reader would hear.
  // Each announcement differs from the last by a trailing no-break space at most: the same words
  // twice («تم اختيار 3», then 3 more) would change nothing in the region, and say nothing.
  const [announced, setAnnounced] = useState('');
  const pickAllMatches = (drop: boolean): void => {
    const found = matches.map((o) => o.value);
    onChange(withAllMatches(value, found, drop));
    const words = t(drop ? 'common.filters.droppedMatches' : 'common.filters.pickedMatches', {
      count: found.length,
    });
    setAnnounced((last) => (last === words ? `${words}\u00A0` : words));
    searchRef.current?.focus();
  };
  // A closed list keeps nothing to say: reopened, its region starts silent.
  useEffect(() => {
    // Only when there is something to drop: no state is set on the closing of a list that never
    // announced anything — every filter bar's MultiSelect.
    if (!open && announced !== '') setAnnounced('');
  }, [open]);

  const clearAll = (): void => {
    onChange([]);
    if (query !== '') searchFor('');
    searchRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isComposing) return;
    if (floating && open && e.key === 'Tab') {
      // A floating panel sits at the page's END (a portal), not after its trigger, so Tab is led
      // by hand: from the trigger into the panel, through the panel's own controls (the search,
      // «every match», the clear button — the options are the arrows' — and out at either end,
      // the list closing and the focus going on from the trigger, as from a list that does not
      // float: Shift+Tab to the trigger itself, Tab past it to whatever follows.
      const panel = panelRef.current;
      const target = e.target as HTMLElement;
      const items = panel === null ? [] : panelTabStops(panel);
      if (panel === null || !panel.contains(target)) {
        const first = items[0];
        if (!e.shiftKey && first !== undefined) {
          e.preventDefault();
          first.focus();
        } else {
          setOpen(false);
        }
        return;
      }
      // The stop to go to, by document order — the focus may sit on something in the panel that is
      // not a stop of its own (a browser lets a scrolling list take it).
      const next = e.shiftKey
        ? [...items].reverse().find((item) => followsInDocument(item, target))
        : items.find((item) => followsInDocument(target, item));
      if (next !== undefined) {
        e.preventDefault();
        next.focus();
        return;
      }
      // Off either end: the list closes, and the focus goes on from the trigger — to the trigger
      // itself on Shift+Tab; on Tab the browser's own step carries it past the trigger, as from a
      // list that does not float.
      setOpen(false);
      triggerRef.current?.focus();
      if (e.shiftKey) e.preventDefault();
      return;
    }
    const from =
      e.target === searchRef.current
        ? 'search'
        : e.target === triggerRef.current
          ? 'trigger'
          : 'other';
    const action = multiSelectKey(e.key, { open, highlighted: activeIndex !== -1, from });
    if (action === null) return;
    e.preventDefault();
    if (action === 'open') {
      // Opened from the keyboard, the arrow lands on the first (or last) option at once — of the
      // fresh list, since opening asks again with nothing typed. See `edge`.
      onOpen?.();
      setOpen(true);
      searchFor('');
      setEdge(e.key === 'ArrowUp' ? 'ArrowUp' : 'ArrowDown');
      setSteps((n) => n + 1);
    } else if (action === 'move') {
      setActive(
        nextActiveOption(matches, current, e.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'),
      );
      setEdge(null);
      setSteps((n) => n + 1);
    } else if (action === 'pick') {
      const option = matches[activeIndex];
      if (option !== undefined) {
        // The highlight stays on the option just picked, wherever the pick moves it — not on the
        // row it stood in, which a list that puts the picked first hands to another option.
        setActive(option.value);
        setEdge(null);
        setSteps((n) => n + 1);
        toggle(option.value);
      }
    } else {
      // The list closes and nothing else does: a dialog around this control waits for its own
      // Escape. Focus goes back to the trigger rather than to a panel that is no longer there.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };
  const showClear = clearable && selected > 0;
  // A floating panel goes to the page's body, out of every scrolling box around the trigger.
  // Keys and clicks on it still reach this box: React passes a portal's events up its own tree.
  const renderPanel = (panel: JSX.Element): React.ReactNode =>
    floating ? createPortal(panel, document.body) : panel;

  return (
    // Keys are read on the whole box, so the arrows work from wherever the focus is — the search
    // box, or the trigger of a list too short to have one.
    <div ref={boxRef} className={cn('relative', className)} onKeyDown={onKeyDown}>
      {/* The trigger and its ✕ share one box, so the ✕ sits on the trigger's own end however the
          bar sizes it. The ✕ comes AFTER the trigger in the markup: it is a second control, never
          a part of the button (a button cannot hold another). */}
      <div className={cn('relative max-w-full', fullWidth ? 'flex w-full' : 'inline-flex')}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          {...(open ? { 'aria-controls': listId } : {})}
          aria-label={label}
          // The label replaces what the trigger SHOWS, so once the picks are named on it they are
          // its description: a screen reader hears the question, then what is picked.
          {...(summary === null ? {} : { 'aria-describedby': `${listId}-summary` })}
          // The same question the screen reader gets, for a pointer — a trigger sized by its bar
          // can be narrower than the words on it, and then this is the only way to read them.
          title={label}
          onClick={() => {
            if (!open) onOpen?.();
            setOpen((o) => !o);
            // The owner's results still hold the last query; ask for the opening answer again.
            searchFor('');
          }}
          className={cn(
            'inline-flex items-center rounded-lg border',
            size === 'sm' ? 'h-8 py-1 text-xs' : 'py-2 text-sm',
            // `justify-between` as well as `w-full`: once the trigger is wider than its own text the
            // chevron belongs at the far edge, the way a `<select>`'s does, not tucked against the
            // label with dead space after it.
            fullWidth && 'w-full justify-between',
            // Only the GUTTERS tighten. The type size stays `text-sm`, which is what `Input` and
            // `Select` are at BOTH densities — `density` moves their padding and nothing else. This
            // used to drop to `text-xs`, and the 4px of line-height it lost made the trigger 34px
            // tall in a row of 38px boxes: on the violations bar that showed as two filters sitting
            // lower than the two beside them, and on the drivers registry as one short box among
            // ten. A row of controls is only one row if the controls are one height.
            density === 'tight' ? 'gap-1 px-2' : 'gap-1.5 px-3',
            // Room at the end for the ✕, so the chosen values never run under it.
            showClear && (density === 'tight' ? 'pe-8' : 'pe-9'),
            // Never wider than the box it was given. A no-op for every bar that sizes this control
            // to its content, and the thing that keeps a trigger inside its lane when a caller
            // sizes it instead — a filter bar holding eleven controls on one row does.
            'max-w-full',
            'focus:border-brand-400 focus:outline-none',
            missing
              ? 'border-red-400 bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200'
              : selected > 0
                ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200'
                : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
          )}
        >
          {/* Nothing chosen: the question. Something chosen: the answer — and the answer replaces
            the question rather than sitting beside it, because the row has no space for both and
            `aria-label` already tells a screen reader which filter this is. */}
          {summary === null ? (
            <span
              // `truncate`, like the chosen-values branch below: the question can be longer than a
              // narrow trigger, and an ellipsis is the honest end of it. It also carries
              // `overflow: hidden`, which is what lets this shrink inside the flex button at all.
              className={cn('truncate', placeholder !== undefined && 'text-slate-400')}
            >
              {placeholder ?? label}
            </span>
          ) : (
            <span id={`${listId}-summary`} className="max-w-48 truncate" title={summary}>
              {summary}
            </span>
          )}
          {/* The count IS the "this list is filtered" signal — never hide it behind a colour alone.
            It is redundant once the values are named, so it steps aside there. */}
          {summary === null && selected > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
              {selected}
            </span>
          )}
          <ChevronIcon className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
        {showClear && (
          <button
            type="button"
            data-multiselect-clear="true"
            aria-label={`${t('common.filters.clearAll')} — ${label}`}
            title={t('common.filters.clearAll')}
            onClick={clearAll}
            className={cn(
              'absolute inset-y-0 my-auto inline-flex h-6 w-6 items-center justify-center rounded-md',
              density === 'tight' ? 'end-1' : 'end-1.5',
              'text-brand-600 hover:bg-brand-100 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900',
            )}
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open &&
        renderPanel(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-multiselectable
            {...(activeIndex === -1 ? {} : { 'aria-activedescendant': optionId(activeIndex) })}
            style={
              floating
                ? spot === null
                  ? // Measured before it is painted (a layout effect), so it never flashes at the
                    // page's corner. Transparent, not `visibility: hidden`: a hidden search box
                    // refuses the focus it is given on this very render.
                    { top: 0, left: 0, opacity: 0 }
                  : {
                      left: spot.left,
                      maxHeight: spot.maxHeight,
                      ...(spot.below ? { top: spot.top } : { bottom: spot.bottom }),
                    }
                : pin === 'left'
                  ? { left: 0, right: 'auto' }
                  : pin === 'right'
                    ? { right: 0, left: 'auto' }
                    : undefined
            }
            className={cn(
              floating ? 'fixed z-[60]' : 'absolute z-30 mt-1',
              'max-h-72 overflow-hidden rounded-lg border border-slate-200 shadow-lg',
              // A column, so the list SHRINKS to leave the search, the chips and «مسح الكل» on screen.
              // Without it the list kept its own height and pushed the footer out of the panel — and
              // a floating panel's height is the room the viewport has left it.
              (clearable || floating) && 'flex flex-col',
              panelWidth ?? 'w-56',
              // A step lighter than the page in dark mode: on near-black a shadow says nothing, so
              // the surface itself has to read as floating.
              'bg-white dark:border-slate-600 dark:bg-slate-800',
            )}
          >
            {searchable && (
              <div className="shrink-0 border-b border-slate-100 p-2 dark:border-slate-700">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute inset-y-0 start-2 my-auto h-4 w-4 text-slate-400" />
                  <input
                    ref={searchRef}
                    type="text"
                    role="combobox"
                    aria-expanded
                    aria-controls={listId}
                    aria-autocomplete="list"
                    {...(activeIndex === -1
                      ? {}
                      : { 'aria-activedescendant': optionId(activeIndex) })}
                    // «every match» says what Enter will do while it is offered.
                    {...(matchesRow ? { 'aria-describedby': `${listId}-matches` } : {})}
                    value={query}
                    onChange={(e) => searchFor(e.target.value)}
                    onKeyDown={(e) => {
                      // A highlighted option takes Enter (see `multiSelectKey`); the typed text only
                      // when nothing is highlighted.
                      if (e.key !== 'Enter' || activeIndex !== -1) return;
                      if (matchesRow) {
                        // `pickMatches`: Enter takes what the search found, as a sheet's filter does —
                        // and gives it back when all of it is already picked.
                        e.preventDefault();
                        pickAllMatches(allMatchesPicked);
                        return;
                      }
                      if (onCommitSearch === undefined) return;
                      e.preventDefault();
                      onCommitSearch(query);
                      searchFor('');
                    }}
                    placeholder={t('common.search')}
                    className="w-full rounded-md border border-slate-200 bg-white py-1.5 pe-2 ps-8 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            )}

            {chips && selected > 0 && (
              <div
                className={cn(
                  'flex flex-wrap gap-1 border-b border-slate-100 p-2 dark:border-slate-700',
                  clearable && 'max-h-24 shrink-0 overflow-y-auto',
                )}
              >
                {value.map((selectedValue) => {
                  // A chip says what the OPTION says, not what the value is — `optionLabel`, the
                  // same function the trigger's summary uses, so the two always agree.
                  const shown = optionLabel(options, selectedValue);
                  return (
                    <span
                      key={selectedValue}
                      className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                    >
                      {/* `auto` rather than `ltr`: these chips carry Latin codes on some screens and
                        Arabic names on others, and a name forced left-to-right puts its comma on
                        the wrong end. The first strong character decides, which is right for both. */}
                      <span dir="auto" className="truncate">
                        {shown}
                      </span>
                      <button
                        type="button"
                        aria-label={`${t('common.filters.clearOne')} ${shown}`}
                        onClick={() => toggle(selectedValue)}
                        className="shrink-0 text-brand-500 hover:text-brand-800 dark:hover:text-brand-100"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <ul
              ref={listRef}
              // Not a Tab stop of its own: a browser may make a scrolling list one, and a floating
              // panel leads Tab by hand (see `onKeyDown`).
              {...(floating ? { tabIndex: -1 } : {})}
              className={cn(
                'overflow-y-auto py-1',
                clearable || floating ? 'min-h-0 flex-1' : 'max-h-52',
              )}
            >
              {matches.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-400">
                  {emptyListText(t, { searching, emptyText })}
                </li>
              )}
              {matches.length > 0 && statusText !== undefined && (
                <li className="px-3 py-2 text-sm text-slate-400">{statusText}</li>
              )}
              {matchesRow && (
                <li className="border-b border-slate-100 dark:border-slate-700">
                  <button
                    type="button"
                    data-multiselect-matches="true"
                    aria-pressed={allMatchesPicked}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickAllMatches(allMatchesPicked)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid h-4 w-4 shrink-0 place-items-center rounded border',
                        allMatchesPicked
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-slate-300 bg-white dark:border-slate-500 dark:bg-slate-900',
                      )}
                    >
                      {allMatchesPicked && <CheckIcon className="h-3 w-3" />}
                    </span>
                    <span id={`${listId}-matches`} className="truncate">
                      {t('common.filters.pickMatches', { count: matches.length })}
                    </span>
                  </button>
                </li>
              )}
              {matches.map((option, index) => {
                const checked = value.includes(option.value);
                const highlighted = index === activeIndex;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      id={optionId(index)}
                      // A floating list's options are the arrows' (`aria-activedescendant`), not Tab's:
                      // Tab goes on to the panel's own controls rather than through every value.
                      {...(floating ? { tabIndex: -1 } : {})}
                      aria-selected={checked}
                      {...(highlighted ? { 'data-active': 'true' } : {})}
                      // Pressing an option does not take the focus from the search box — the caret
                      // stays where the reader is typing. The click still lands as it always did.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggle(option.value)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700',
                        // The keyboard's row: the hover's own grey, so it reads as "here", not "picked"
                        // — and a grey outline, so it is told from the row the pointer rests on, the
                        // one Enter does NOT pick.
                        highlighted &&
                          'bg-slate-100 ring-1 ring-inset ring-slate-300 dark:bg-slate-700 dark:ring-slate-500',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'grid h-4 w-4 shrink-0 place-items-center rounded border',
                          checked
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-slate-300 bg-white dark:border-slate-500 dark:bg-slate-900',
                        )}
                      >
                        {checked && <CheckIcon className="h-3 w-3" />}
                      </span>
                      <span className="truncate">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {pickMatches && (
              <span className="sr-only" aria-live="polite">
                {announced}
              </span>
            )}

            {selected > 0 && (
              <div className="shrink-0 border-t border-slate-100 p-1.5 dark:border-slate-700">
                <button
                  type="button"
                  {...(clearable ? { 'data-multiselect-clear-all': 'true' } : {})}
                  onClick={clearable ? clearAll : () => onChange([])}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-700',
                    clearable
                      ? 'font-medium text-red-600 dark:text-red-400'
                      : 'text-slate-500 dark:text-slate-400',
                  )}
                >
                  {clearable ? t('common.filters.clearAll') : t('common.filters.clearOne')}
                </button>
              </div>
            )}
          </div>,
        )}
    </div>
  );
};
