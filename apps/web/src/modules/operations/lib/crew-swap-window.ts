// Round 34 D — «تبديل بين سيارتين»: the window's own state, as a pure model.
//
// THE OWNER, on Round 34 A's arrows: «أنا مش عايز كده، أنت كده عامل لي إن السهم اللي فوق رصاصي والسهم
// اللي تحت رصاصي واللي في النص بنفسجي. أنا يعتبر محدد اللي في النص. البنفسجي ده هو اللون الأشمل
// للويب سايت. أنا عايز تكون ألوان مختلفة، فاهم قصدي؟ ولما أنا أبقى هوفر يبقى يجيلي اللون ده، أو لو
// أنا اخترت شمال أو يمين مثلا يفضل موجود لحد ما الداتا تتنقل ثانية أو ثانيتين ويقوم جاي متشال».
//
// THE ARROWS ARE ACTIONS, not a choice that stays made. The window holds:
//   · the TICKS on each card (`picks`) — what the next press sends;
//   · the PRESSES so far (`steps`) — the cards are those steps replayed over the two rows
//     (`replaySwap`), so a press moves the ticked items at once and the next one works on what it
//     left; «تراجع عن آخر نقل» takes the last one back, with its ticks, down to the opening state;
//   · what the LAST press did (`last`) — what crossed and what a board rule kept back, for the
//     notice under the arrows and the footer;
//   · the arrow HELD (`held`) — the one just pressed stays in its colour while the data moves
//     across (`SWAP_HOLD_MS`), then goes back to rest (`settle`, from `createSwapHoldClock`);
//   · the CLOSE QUESTION (`closing`, Round 34 D critic) — ✕, Escape or «إلغاء» while the moves
//     change something ask first: «تطبيق» them, or drop them, or go on.
// Nothing here touches the board: «تطبيق» hands `steps` to the page, which replays them on its
// draft as ONE step of its «تراجع»; «تجاهل التغييرات» (or closing with nothing changed) drops this
// state with the window.
//
// Pure: the window feeds it the keys and the rows; a suite drives it with no DOM. The window holds
// it in `createSwapWindow` — the state, the press and the hold's clock in one object (Round 34 D
// critic: the press and the clock were wired by hand inside the component, where no suite reached
// them; a press that never started the clock would have held every arrow for good).
import { type PlanRow } from './crew-plan';
import {
  NO_PICKS,
  livePicks,
  planSwap,
  quickPick,
  sendsFrom,
  swapArrivals,
  swapItems,
  swapReplacedValues,
  swapSlotChanges,
  type QuickPick,
  type SwapMode,
  type SwapMove,
  type SwapPicks,
  type SwapRefused,
  type SwapRules,
  type SwapSide,
  type SwapStep,
} from './crew-swap';

/**
 * How long a pressed arrow stays filled in its colour — «ثانية أو ثانيتين» — while the moved items
 * land on the other card; the glyph's nudge toward the receiving card runs twice in it (700ms each,
 * `swap-nudge` in tailwind.config.ts).
 */
export const SWAP_HOLD_MS = 1400;

/** What one press did: its way, what crossed, what a rule kept back where it was. */
export interface SwapPress {
  mode: SwapMode;
  moved: readonly SwapMove[];
  refused: readonly SwapRefused[];
}

export interface SwapWindowState {
  picks: SwapPicks;
  steps: readonly SwapStep[];
  last: SwapPress | null;
  held: SwapMode | null;
  /** ✕, Escape or «إلغاء» asked while the moves change something: apply, drop, or go on. */
  closing: boolean;
}

export const SWAP_WINDOW_START: SwapWindowState = {
  picks: NO_PICKS,
  steps: [],
  last: null,
  held: null,
  closing: false,
};

/**
 * Why an arrow cannot be pressed now — said in its tooltip and its name:
 *   · `pickSecond` — no second van yet;
 *   · `playing` — a press is still playing (the arrow held);
 *   · `nothingTicked` — nothing ticked on the card(s) it sends from (the swap: on either card).
 */
export type SwapArrowWhy = 'pickSecond' | 'playing' | 'nothingTicked';

export const swapArrowWhy = (
  state: SwapWindowState,
  mode: SwapMode,
  rows: { a: PlanRow; b: PlanRow } | null,
): SwapArrowWhy | null => {
  if (rows === null) return 'pickSecond';
  if (state.held !== null) return 'playing';
  const live = livePicks(rows.a, rows.b, state.picks);
  const sent = (side: SwapSide): number => (sendsFrom(mode, side) ? live[side].length : 0);
  return sent('a') + sent('b') === 0 ? 'nothingTicked' : null;
};

export type SwapWindowAction =
  /** A box ticked or unticked on a card. */
  | { type: 'tick'; side: SwapSide; id: string }
  /** «الكل» · «الطاقم فقط» · «لا شيء» on a card, as the card shows the row. */
  | { type: 'quick'; side: SwapSide; row: PlanRow; pick: QuickPick }
  /**
   * An arrow pressed, on the two rows the cards show now (the working copy); `home` — the two rows
   * the window opened on, as `replaySwap` replays the presses over them (a person going back to
   * his row goes back to his own seat).
   */
  | {
      type: 'press';
      mode: SwapMode;
      rows: { a: PlanRow; b: PlanRow };
      home?: { a: PlanRow; b: PlanRow };
      rules: SwapRules;
    }
  /** The hold is over: the arrow back at rest. */
  | { type: 'settle' }
  /** «تراجع عن آخر نقل». */
  | { type: 'undo' }
  /** Another second van (or the one chosen gone): the first card's ticks kept, the rest anew. */
  | { type: 'second' }
  /** ✕, Escape or «إلغاء» with moves that change something: the question asked. */
  | { type: 'ask' }
  /** «متابعة التعديل» (or ✕ / Escape on the question): back to the window as it was. */
  | { type: 'stay' };

/**
 * A tick still naming what it named before the press: the person still on that row, the field
 * still holding the value it held — a value that ARRIVED on it is not what was ticked.
 */
const untouched = (before: PlanRow, after: PlanRow, id: string): boolean => {
  const was = swapItems(before).find((item) => item.id === id);
  const now = swapItems(after).find((item) => item.id === id);
  if (was === undefined || now === undefined) return false;
  return (
    was.kind === 'person' ||
    (now.kind === 'field' && was.kind === 'field' && now.value === was.value)
  );
};

export const swapWindowReducer = (
  state: SwapWindowState,
  action: SwapWindowAction,
): SwapWindowState => {
  switch (action.type) {
    case 'tick': {
      const list = state.picks[action.side];
      const next = list.includes(action.id)
        ? list.filter((one) => one !== action.id)
        : [...list, action.id];
      return { ...state, picks: { ...state.picks, [action.side]: next } };
    }
    case 'quick':
      return {
        ...state,
        picks: { ...state.picks, [action.side]: quickPick(action.row, action.pick) },
      };
    case 'press': {
      if (swapArrowWhy(state, action.mode, action.rows) !== null) return state;
      const { a, b } = action.rows;
      const picks = livePicks(a, b, state.picks);
      const outcome = planSwap(a, b, picks, action.mode, action.rules, action.home);
      const last = { mode: action.mode, moved: outcome.moved, refused: outcome.refused };
      // A press that moved nothing (everything kept back) is no step to take back — and its ticks
      // stay as they were: nothing they named has gone (Round 34 D critic: they cleared, and the
      // undo could not give them back — it took back the move before instead).
      if (outcome.moved.length === 0) return { ...state, last, held: action.mode, closing: false };
      // The ticks the press READ clear — what they named has gone, or a rule keeps it, said under
      // the arrows. A one-way arrow never reads the receiving card's ticks: they stay (Round 34 D
      // critic — they cleared too), but for a field that took the arriving value.
      const after = { a: outcome.a, b: outcome.b };
      const kept = (side: SwapSide): readonly string[] =>
        sendsFrom(action.mode, side)
          ? []
          : picks[side].filter((id) => untouched(action.rows[side], after[side], id));
      return {
        picks: { a: kept('a'), b: kept('b') },
        steps: [...state.steps, { picks, mode: action.mode }],
        last,
        held: action.mode,
        closing: false,
      };
    }
    case 'settle':
      return state.held === null ? state : { ...state, held: null };
    case 'undo': {
      const step = state.steps[state.steps.length - 1];
      if (step === undefined) return state;
      // One move back — its items home again, and ticked as they were before it.
      return {
        picks: step.picks,
        steps: state.steps.slice(0, -1),
        last: null,
        held: null,
        closing: false,
      };
    }
    case 'second':
      return state.steps.length === 0 &&
        state.last === null &&
        state.held === null &&
        state.picks.b.length === 0
        ? state
        : { ...SWAP_WINDOW_START, picks: { a: state.picks.a, b: [] } };
    case 'ask':
      return state.closing ? state : { ...state, closing: true };
    case 'stay':
      return state.closing ? { ...state, closing: false } : state;
  }
};

/**
 * What ✕, Escape and «إلغاء» do (Round 34 D critic — they dropped every move without a word, while
 * the cards showed the data moved): with nothing changed they close; with moves that change
 * something they ask first («تطبيق» them, or drop them, or go on); on the question itself they go
 * back to the window.
 */
export const swapCloseStep = (
  state: SwapWindowState,
  changed: boolean,
): 'close' | 'ask' | 'stay' => (state.closing ? 'stay' : changed ? 'ask' : 'close');

/**
 * The footer's «نُقل … — بقي …» (Round 34 D critic — it summed every press, so there and back read
 * «نُقل: ٢» beside «لم يتغيّر شيء بعد»): what differs from the opening, as the cards show it —
 * `moved` every item on a card it did not open on («من 213») or in another slot of its own
 * («من أخصائي 1»), `replaced` every value on neither row now («بدلًا من …»); `kept` what the last
 * press could not move (a rule kept it where it is — named under the arrows).
 */
export const swapWindowCounts = (
  opening: { a: PlanRow; b: PlanRow } | null,
  work: { a: PlanRow; b: PlanRow } | null,
  state: SwapWindowState,
): { moved: number; replaced: number; kept: number } => {
  const kept = state.last?.refused.length ?? 0;
  if (opening === null || work === null) return { moved: 0, replaced: 0, kept };
  const arrived = swapArrivals(opening, work);
  const seats = swapSlotChanges(opening, work);
  return {
    moved: arrived.a.size + arrived.b.size + seats.a.size + seats.b.size,
    replaced: swapReplacedValues(opening, work).length,
    kept,
  };
};

/**
 * Which card(s) the held arrow sends to — framed in its colour, «تستقبل», while it plays: the
 * other card for a one-way arrow, both for the swap.
 */
export const swapReceiving = (held: SwapMode | null, side: SwapSide): boolean =>
  held !== null && (held === 'swap' || sendsFrom(held, side === 'a' ? 'b' : 'a'));

/** The hold's clock: `start` (again) and `settle` runs once, `ms` later; `stop` drops it. */
export interface SwapHoldClock {
  start: () => void;
  stop: () => void;
}

export const createSwapHoldClock = (settle: () => void, ms = SWAP_HOLD_MS): SwapHoldClock => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    start: () => {
      stop();
      timer = setTimeout(() => {
        timer = null;
        settle();
      }, ms);
    },
    stop,
  };
};

/** The window's state with what acts on it: a store the component reads (`useSyncExternalStore`). */
export interface SwapWindow {
  getState: () => SwapWindowState;
  /** The window watching; when the last watcher goes (the window closed), the hold's clock stops. */
  subscribe: (listener: () => void) => () => void;
  /** A tick, a quick pick, another second van, the close question. */
  send: (action: Exclude<SwapWindowAction, { type: 'press' | 'settle' | 'undo' }>) => void;
  /** An arrow pressed: the move made at once and the arrow held; `SWAP_HOLD_MS` later it rests. */
  press: (press: Omit<Extract<SwapWindowAction, { type: 'press' }>, 'type'>) => void;
  /** «تراجع عن آخر نقل» — a hold still playing ends with it. */
  undo: () => void;
}

export const createSwapWindow = (
  initial: SwapWindowState = SWAP_WINDOW_START,
  ms = SWAP_HOLD_MS,
): SwapWindow => {
  let state = initial;
  const listeners = new Set<() => void>();
  const become = (next: SwapWindowState): void => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const clock = createSwapHoldClock(() => become(swapWindowReducer(state, { type: 'settle' })), ms);
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) clock.stop();
      };
    },
    send: (action) => become(swapWindowReducer(state, action)),
    press: (press) => {
      const next = swapWindowReducer(state, { type: 'press', ...press });
      // An arrow that cannot act changes nothing — and holds nothing.
      if (next === state) return;
      become(next);
      clock.start();
    },
    undo: () => {
      clock.stop();
      become(swapWindowReducer(state, { type: 'undo' }));
    },
  };
};
