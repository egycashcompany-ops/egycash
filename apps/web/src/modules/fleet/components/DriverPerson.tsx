// «تحسين اختيار السواقيين … وتحسين شكل البيانات فى جداول العدادات والصيانه و خصم الايصالات و التمامات».
//
// A DRIVER, drawn one way wherever a Fleet board or form shows or picks one: the round badge with
// the first letters of the name that the drivers board draws, the name, and the employee code
// under it — never glued to the name's last letter, as «ابراهيم السيد رزق جابر0100765» was.
//
// Two pickers share one list:
// - `DriverPicker` picks a PERSON (an employee id) — the reading and workshop forms, attendance.
// - `DriverNameCombobox` is a NAME box that offers the roster as it is typed into — the receipt,
//   whose driver is a name that may be somebody the roster does not know.
// Both search Fleet's own roster by name or code, Arabic folded («احمد» finds «أحمد»).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { type FleetPersonDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { foldIncludes } from '../../../shared/lib/fold';
import { CloseIcon, SearchIcon } from '../../../shared/ui/icons';
import { useFieldMissing } from '../../../shared/ui/required-fields';
import { useEmployeeRecord, useFleetPeopleMap } from './EmployeeName';

/** The drivers board's badge colours — one per person, the same person always the same colour. */
const AVATAR_TONES = [
  'bg-gradient-to-br from-violet-500 to-indigo-600 text-white ring-violet-400/40',
  'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
  'bg-gradient-to-br from-amber-400 to-orange-500 text-white ring-amber-400/40',
  'bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300',
  'bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-emerald-400/40',
  'bg-indigo-500/15 text-indigo-700 ring-indigo-500/30 dark:text-indigo-300',
  'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',
] as const;

const toneOf = (key: string): string =>
  AVATAR_TONES[[...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length]!;

/** «ابراهيم السيد» → «اس»: the first letter of the first two words — «السيد» gives «س». */
export const driverInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => (word.startsWith('ال') && word.length > 2 ? word.charAt(2) : word.charAt(0)))
    .join('');

export const DriverAvatar = ({
  name,
  seed,
  size = 'md',
  muted = false,
}: {
  name: string;
  /** What picks the colour — the employee code, so a person keeps theirs on every screen. */
  seed: string;
  size?: 'sm' | 'md';
  /** A name from the old books: grey, no colour of a person the roster knows. */
  muted?: boolean;
}): JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'flex shrink-0 items-center justify-center rounded-full font-black ring-1',
      size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-[11px]',
      muted ? 'bg-slate-500/15 text-slate-500 ring-slate-500/30 dark:text-slate-400' : toneOf(seed),
    )}
  >
    {driverInitials(name)}
  </span>
);

/** The badge, the name, and the code under it. */
export const DriverIdentity = ({
  name,
  code,
  nameClassName,
  muted = false,
  size = 'md',
  title,
}: {
  name: string;
  code: string | null;
  /** A screen that colours its drivers (the reading's two shifts) colours the NAME. */
  nameClassName?: string;
  muted?: boolean;
  size?: 'sm' | 'md';
  title?: string;
}): JSX.Element => (
  <span className="inline-flex min-w-0 items-center gap-2.5 text-start" title={title ?? name}>
    <DriverAvatar name={name} seed={code ?? name} size={size} muted={muted} />
    <span className="min-w-0 leading-tight">
      <span
        className={cn(
          'block max-w-[14rem] truncate font-bold',
          muted && 'text-slate-500 dark:text-slate-400',
          nameClassName,
        )}
      >
        {name}
      </span>
      {code !== null && code !== '' && (
        // Under the START of the name — the code reads left to right, but sits where the name
        // begins, not at the far end of the line.
        <span className="mt-0.5 block">
          <span
            dir="ltr"
            className="inline-block font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            {code}
          </span>
        </span>
      )}
    </span>
  </span>
);

/**
 * How a board writes a driver — «غير شكل اسم السواق»: each board's look, as the owner chose it.
 * - `identity`: the badge, the name, the code under it (the pickers' look; receipts, attendance).
 * - `person`: look ج — a person mark, the name, a rule, the code faint after it (odometer).
 * - `short`: look د — the first and last names, the code under; the whole name on hover
 *   (maintenance).
 */
export type DriverLook = 'identity' | 'person' | 'short';

const DriverLookView = ({
  look,
  name,
  code,
  nameClassName,
  muted = false,
}: {
  look: DriverLook;
  name: string;
  code: string | null;
  nameClassName?: string;
  muted?: boolean;
}): JSX.Element => {
  const codeShown = code !== null && code !== '';
  const mono = 'font-mono font-bold';
  if (look === 'person') {
    return (
      <span className="inline-flex min-w-0 items-center gap-2" title={name}>
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
          </svg>
        </span>
        <span
          className={cn(
            'max-w-[13rem] truncate font-extrabold',
            muted && 'text-slate-500',
            nameClassName,
          )}
        >
          {name}
        </span>
        {codeShown && (
          <>
            <span aria-hidden className="h-4 w-px shrink-0 bg-slate-300 dark:bg-slate-600" />
            <span dir="ltr" className={cn(mono, 'shrink-0 text-[12px] text-slate-500')}>
              {code}
            </span>
          </>
        )}
      </span>
    );
  }
  if (look === 'short') {
    const words = name.trim().split(/\s+/u);
    const short = words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : name;
    return (
      <span className="inline-flex flex-col items-center gap-0.5" title={name}>
        <span
          className={cn(
            'whitespace-nowrap text-[15px] font-extrabold',
            muted && 'text-slate-500',
            nameClassName,
          )}
        >
          {short}
        </span>
        {codeShown && (
          <span dir="ltr" className={cn(mono, 'text-[11px] tracking-wide text-slate-500')}>
            {code}
          </span>
        )}
      </span>
    );
  }
  return (
    <DriverIdentity
      name={name}
      code={code}
      muted={muted}
      {...(nameClassName === undefined ? {} : { nameClassName })}
    />
  );
};

/**
 * A DRIVER cell on a board's row. The person Fleet knows, by id; or — on a row from the old books
 * whose spelling HR never had — the name as the book wrote it, grey, saying where it came from;
 * or a dash.
 */
export const DriverCell = ({
  employeeId,
  name,
  nameClassName,
  look = 'identity',
}: {
  employeeId: string | null;
  name?: string | null;
  nameClassName?: string;
  look?: DriverLook;
}): JSX.Element => {
  const person = useEmployeeRecord(employeeId ?? '');
  if (employeeId !== null && person !== undefined && person.fullNameAr !== '') {
    return (
      <DriverLookView
        look={look}
        name={person.fullNameAr}
        code={person.code}
        {...(nameClassName === undefined ? {} : { nameClassName })}
      />
    );
  }
  if (employeeId !== null) {
    // Somebody the roster does not carry (or not yet loaded): the id's tail, as before.
    return (
      <span className="font-mono text-xs text-slate-400" dir="ltr">
        {employeeId.slice(-8)}
      </span>
    );
  }
  if (name != null && name !== '') {
    return (
      <span data-legacy-name="true">
        <DriverLookView look={look} name={name} code={null} muted />
      </span>
    );
  }
  return <span className="text-slate-400">—</span>;
};

// ── The list both pickers open ──────────────────────────────────────────────────────────────

/** Fleet's roster, by name, narrowed by what was typed — name or code, Arabic folded. */
const useRosterMatches = (term: string): FleetPersonDto[] => {
  const roster = useFleetPeopleMap();
  return useMemo(() => {
    const all = [...roster.values()].sort((a, b) => a.fullNameAr.localeCompare(b.fullNameAr, 'ar'));
    const typed = term.trim();
    if (typed === '') return all;
    return all.filter(
      (person) => foldIncludes(person.fullNameAr, typed) || person.code.includes(typed),
    );
  }, [roster, term]);
};

/**
 * Where the list is drawn: under its box, measured when it opens and again on every scroll or
 * resize, in a layer of its own. A form's body scrolls, and a list drawn INSIDE it would be cut
 * off by it; flipped above the box when there is no room below.
 */
/** A layout effect in the browser; a plain one where there is no layout (a static render). */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const useAnchoredPanel = (
  open: boolean,
  anchor: RefObject<HTMLElement>,
): { top: number; left: number; width: number; maxHeight: number } | null => {
  const [at, setAt] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  useBrowserLayoutEffect(() => {
    if (!open) return undefined;
    const place = (): void => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const room = window.innerHeight - rect.bottom - 12;
      const above = room < 220 && rect.top > room;
      const maxHeight = Math.min(340, Math.max(160, above ? rect.top - 12 : room));
      // Wide enough for a whole name; its start edge on the box's start edge (the right, in
      // Arabic), and kept on the screen.
      const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 340));
      const rtl = getComputedStyle(anchor.current as Element).direction === 'rtl';
      const left = rtl ? rect.right - width : rect.left;
      setAt({
        top: above ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
        left: Math.min(window.innerWidth - width - 8, Math.max(8, left)),
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchor]);
  return open ? at : null;
};

const RosterList = ({
  open,
  anchor,
  panelRef,
  matches,
  active,
  pickedId,
  onPick,
  onHover,
  search,
  listId,
  hideWhenEmpty = false,
}: {
  open: boolean;
  anchor: RefObject<HTMLElement>;
  panelRef: RefObject<HTMLDivElement>;
  matches: readonly FleetPersonDto[];
  active: number;
  pickedId: string | null;
  onPick: (person: FleetPersonDto) => void;
  onHover: (index: number) => void;
  /** The search box the person-picker puts on top; the name box searches in its own box. */
  search?: ReactNode;
  listId: string;
  /** Draw nothing rather than «no match» — the name box, where a name nobody knows is fine. */
  hideWhenEmpty?: boolean;
}): JSX.Element | null => {
  const t = useT();
  const at = useAnchoredPanel(open, anchor);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  if (!open || at === null || typeof document === 'undefined') return null;
  if (hideWhenEmpty && matches.length === 0) return null;
  return createPortal(
    <div
      ref={panelRef}
      data-driver-list="true"
      style={{
        top: at.top,
        left: at.left,
        width: at.width,
        maxHeight: at.maxHeight,
      }}
      className="fixed z-[100] flex animate-menu-in flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#2b3b6b] dark:bg-[#131d35] [font-family:'Cairo',sans-serif]"
    >
      {search}
      {matches.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-slate-500 dark:text-slate-400">
          {t('fleet.drivers.pickerNoResults')}
        </p>
      ) : (
        <ul ref={listRef} id={listId} role="listbox" className="min-h-0 overflow-y-auto p-1.5">
          {matches.map((person, index) => {
            const picked = person.employeeId === pickedId;
            return (
              <li
                key={person.employeeId}
                role="option"
                aria-selected={picked}
                data-index={index}
                data-driver-option={person.employeeId}
                // `mousedown`, not `click`: the box keeps its focus, and the pick lands before the
                // box's own blur would close the list under the pointer.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(person);
                }}
                onMouseEnter={() => onHover(index)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 transition',
                  picked
                    ? 'bg-brand-500/15 ring-1 ring-brand-500/50'
                    : index === active
                      ? 'bg-slate-100 dark:bg-slate-800/80'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                )}
              >
                {/* The whole name in the list — a long one wraps rather than being cut. */}
                <DriverIdentity
                  name={person.fullNameAr}
                  code={person.code}
                  nameClassName="!max-w-none whitespace-normal"
                />
                {picked && (
                  <span className="shrink-0 text-xs font-black text-brand-600 dark:text-brand-300">
                    ✓
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
};

/**
 * Arrow keys walk the list, Enter picks the highlighted one, Escape closes it — and only it, not
 * the form — and Tab closes it and lets the focus go on to the next field. `closed` runs after a
 * close from the keyboard, so the person-picker can give the focus back to its box.
 */
const useListKeys = (
  open: boolean,
  setOpen: (next: boolean) => void,
  matches: readonly FleetPersonDto[],
  active: number,
  setActive: (next: number) => void,
  pick: (person: FleetPersonDto) => void,
  closed: () => void = () => undefined,
) => {
  return (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(matches.length - 1, Math.max(0, active + step)));
    } else if (e.key === 'Enter' && open) {
      const person = matches[active];
      if (person !== undefined) {
        e.preventDefault();
        pick(person);
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      closed();
    } else if (e.key === 'Tab' && open) {
      // Not prevented: the focus moves on from wherever `closed` puts it.
      setOpen(false);
      closed();
    }
  };
};

/** Closes the list on a press anywhere but the box and the list. */
const useOutsidePress = (
  open: boolean,
  refs: readonly RefObject<HTMLElement>[],
  close: () => void,
): void => {
  useEffect(() => {
    if (!open) return undefined;
    const press = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      close();
    };
    document.addEventListener('mousedown', press);
    return () => document.removeEventListener('mousedown', press);
  }, [open, refs, close]);
};

let nextListId = 0;
const useListId = (): string => {
  const [id] = useState(() => {
    nextListId += 1;
    return `driver-list-${nextListId}`;
  });
  return id;
};

// ── Picking a person ────────────────────────────────────────────────────────────────────────

/**
 * Picks ONE driver by employee id. The box shows who is picked — badge, name, code — with a ✕;
 * pressed, it opens the roster with a search box on top.
 */
export const DriverPicker = ({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  testId,
}: {
  /** The picked employee id; '' when nobody is. */
  value: string;
  onChange: (employeeId: string) => void;
  placeholder?: string;
  /** The box's look — the form's design box, passed by the form. */
  className?: string;
  ariaLabel?: string;
  testId?: string;
}): JSX.Element => {
  const t = useT();
  const missing = useFieldMissing();
  const [open, setOpenState] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const matches = useRosterMatches(term);
  const picked = useEmployeeRecord(value);
  /** The list closed from inside it: the focus goes back to the box, not to the page. */
  const backToBox = (): void => comboRef.current?.focus();
  const listId = useListId();
  const setOpen = (next: boolean): void => {
    setOpenState(next);
    if (next) {
      setTerm('');
      setActive(0);
    }
  };
  const close = useMemo(() => () => setOpenState(false), []);
  const refs = useMemo(() => [boxRef, panelRef] as const, []);
  useOutsidePress(open, refs, close);
  // The search box is drawn once the list has its place — after this effect would run — so it
  // takes the focus as it mounts, and typing goes straight into it.
  const focusOnMount = useCallback((el: HTMLInputElement | null): void => {
    el?.focus();
  }, []);
  const pick = (person: FleetPersonDto): void => {
    onChange(person.employeeId);
    setOpenState(false);
    backToBox();
  };
  const keys = useListKeys(open, setOpen, matches, active, setActive, pick, backToBox);

  return (
    <div
      ref={boxRef}
      className="relative"
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <div
        ref={comboRef}
        role="combobox"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel ?? placeholder ?? t('fleet.drivers.pickerPlaceholder')}
        aria-invalid={missing || undefined}
        data-driver-picker="true"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          // The ✕ inside the box handles its own keys: Enter on it clears, it does not open.
          if (e.target !== e.currentTarget) return;
          if (!open && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          } else keys(e);
        }}
        className={cn(
          'flex min-h-[3rem] w-full cursor-pointer items-center justify-between gap-2 border',
          className,
        )}
      >
        {picked !== undefined ? (
          <DriverIdentity name={picked.fullNameAr} code={picked.code} />
        ) : value !== '' ? (
          <span className="font-mono text-xs text-slate-400" dir="ltr">
            {value.slice(-8)}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <SearchIcon className="h-4 w-4" />
            {placeholder ?? t('fleet.drivers.pickerPlaceholder')}
          </span>
        )}
        {value !== '' && (
          <button
            type="button"
            aria-label={t('common.clear')}
            title={t('common.clear')}
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-200/70 hover:text-rose-500 dark:hover:bg-slate-700/60"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      <RosterList
        open={open}
        anchor={boxRef}
        panelRef={panelRef}
        matches={matches}
        active={active}
        pickedId={value === '' ? null : value}
        onPick={pick}
        onHover={setActive}
        listId={listId}
        search={
          <div className="border-b border-slate-200 p-2 dark:border-[#2b3b6b]">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 dark:border-[#2b3b6b] dark:bg-[#0a1233]">
              <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={focusOnMount}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setActive(0);
                }}
                onKeyDown={keys}
                placeholder={t('fleet.drivers.pickerPlaceholder')}
                aria-label={t('fleet.drivers.pickerPlaceholder')}
                aria-controls={listId}
                // The site's focus ring is drawn by the box around it, not by the bare input.
                className="h-9 w-full appearance-none border-0 !bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus-visible:!ring-0 focus-visible:!ring-offset-0 dark:text-white"
              />
            </div>
          </div>
        }
      />
    </div>
  );
};

// ── A name box that offers the roster ───────────────────────────────────────────────────────

/**
 * The receipt's driver: a NAME, typed or picked. Typing narrows the roster under the box;
 * picking writes the person's name into it. Whatever is in the box is the value, as before —
 * a driver the roster does not know is still written by hand.
 */
export const DriverNameCombobox = ({
  value,
  onChange,
  input,
}: {
  value: string;
  onChange: (name: string) => void;
  /**
   * Renders the box itself — the form's own `Input`, so its rule, tone and hooks stay the form's.
   * Handed the props the list needs on it.
   */
  input: (props: InputHTMLAttributes<HTMLInputElement>) => ReactNode;
}): JSX.Element => {
  const [open, setOpenState] = useState(false);
  // NOTHING highlighted until the arrows move onto a name: Enter in this box keeps what was
  // typed, as the plain box did — a name nobody knows must not become the first one that does.
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const roster = useFleetPeopleMap();
  // The box holds a name already picked: show everyone, not only that one person.
  const exact = [...roster.values()].some((person) => person.fullNameAr === value.trim());
  const matches = useRosterMatches(exact ? '' : value);
  const pickedId =
    [...roster.values()].find((person) => person.fullNameAr === value.trim())?.employeeId ?? null;
  const listId = useListId();
  const setOpen = (next: boolean): void => {
    // Nobody to offer — the reader may not read the roster, or it is empty: the box is the plain
    // box it always was.
    setOpenState(next && roster.size > 0);
    if (next) setActive(-1);
  };
  const close = useMemo(() => () => setOpenState(false), []);
  const refs = useMemo(() => [boxRef, panelRef] as const, []);
  useOutsidePress(open, refs, close);
  const pick = (person: FleetPersonDto): void => {
    onChange(person.fullNameAr);
    setOpenState(false);
  };
  const keys = useListKeys(open, setOpen, matches, active, setActive, pick);

  return (
    <div ref={boxRef} className="relative">
      {input({
        role: 'combobox',
        'aria-expanded': open,
        'aria-controls': listId,
        'aria-autocomplete': 'list',
        autoComplete: 'off',
        onFocus: () => setOpen(true),
        onClick: () => setOpen(true),
        // Typing after a pick opens the list again, narrowed by what is typed.
        onInput: () => {
          if (!open) setOpen(true);
          else setActive(-1);
        },
        onKeyDown: keys,
        // Leaving the box closes the list (a pick keeps the focus — its press is held back).
        onBlur: () => setOpenState(false),
      })}
      <RosterList
        open={open}
        anchor={boxRef}
        panelRef={panelRef}
        matches={matches}
        active={active}
        pickedId={pickedId}
        onPick={pick}
        onHover={setActive}
        listId={listId}
        hideWhenEmpty
      />
    </div>
  );
};
