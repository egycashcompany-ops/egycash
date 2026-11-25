// Round 34 D — «تبديل بين سيارتين»: the window's own state (`lib/crew-swap-window.ts`). The owner: «أنا
// مش عايز كده، أنت كده عامل لي إن السهم اللي فوق رصاصي والسهم اللي تحت رصاصي واللي في النص بنفسجي.
// أنا يعتبر محدد اللي في النص. البنفسجي ده هو اللون الأشمل للويب سايت. أنا عايز تكون ألوان مختلفة،
// فاهم قصدي؟ ولما أنا أبقى هوفر يبقى يجيلي اللون ده، أو لو أنا اخترت شمال أو يمين مثلا يفضل موجود
// لحد ما الداتا تتنقل ثانية أو ثانيتين ويقوم جاي متشال، فاهم؟».
//
// Driven with no DOM, as the window drives it: a press MOVES the ticked items on the working copy at
// once (the board's rules keeping someone back, named), the ticks clear, the arrow stays held for
// ~1.4s (fake timers) and rests; several presses follow one another; «تراجع عن آخر نقل» steps back
// one at a time to the opening state; why an arrow cannot act.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PlanRow } from './crew-plan';
import {
  fieldItem,
  personItem,
  replaySwap,
  swapArrivals,
  type SwapRules,
  type SwapStep,
} from './crew-swap';
import {
  SWAP_HOLD_MS,
  SWAP_WINDOW_START,
  createSwapHoldClock,
  createSwapWindow,
  swapArrowWhy,
  swapCloseStep,
  swapReceiving,
  swapWindowCounts,
  swapWindowReducer,
  type SwapWindowAction,
  type SwapWindowState,
} from './crew-swap-window';

const van = (code: string, over: Partial<PlanRow> = {}): PlanRow => ({
  key: `van:v-${code}`,
  vehicleId: `v-${code}`,
  vehicleCode: code,
  onRoster: true,
  crewId: `crew-${code}`,
  drivers: [],
  slots: { captain: [], specialist1: [], specialist2: [] },
  direction: null,
  plannedTime: null,
  shiftTypeId: null,
  rowColour: null,
  notes: null,
  ...over,
});
// 213 holds two captains; 255 one, and room for one more.
const V213 = van('213', {
  slots: { captain: ['c7', 'c8'], specialist1: ['s12'], specialist2: [] },
  direction: 'مدينة نصر',
  plannedTime: '07:30',
});
const V255 = van('255', {
  slots: { captain: ['c20'], specialist1: ['s26'], specialist2: [] },
  direction: 'التجمع الخامس',
  plannedTime: '07:45',
});
const RULES: SwapRules = {
  roleOf: (id) => (id.startsWith('c') ? 'captain' : 'specialist'),
  // 0100020 is on leave.
  awayOf: (id) => (id === 'c20' ? 'onLeave' : null),
  typeMayGo: () => true,
};

const OPENING = { a: V213, b: V255 };

/** The window as the dialog runs it: the state, and the working copy it draws. */
const session = (start: SwapWindowState = SWAP_WINDOW_START) => {
  let state = start;
  const rows = () => {
    const replay = replaySwap(V213, V255, state.steps, RULES);
    return { a: replay.a, b: replay.b, replay };
  };
  const send = (action: SwapWindowAction): SwapWindowState => {
    state = swapWindowReducer(state, action);
    return state;
  };
  return {
    get state() {
      return state;
    },
    rows,
    tick: (side: 'a' | 'b', id: string) => send({ type: 'tick', side, id }),
    press: (mode: SwapStep['mode']) => {
      const { a, b } = rows();
      return send({ type: 'press', mode, rows: { a, b }, home: OPENING, rules: RULES });
    },
    settle: () => send({ type: 'settle' }),
    undo: () => send({ type: 'undo' }),
  };
};

describe('Round 34 D — a press MOVES the ticked items on the working copy', () => {
  it('at once: what crossed lands on the other card «من 213», a rule keeps someone back, the ticks clear', () => {
    const w = session();
    w.tick('a', personItem('c7'));
    w.tick('a', personItem('c8'));
    w.tick('a', fieldItem('direction'));
    const after = w.press('aToB');
    const { a, b } = w.rows();
    // c7 lands on 255 (room for one captain); c8 finds the slot full and stays, named.
    expect(b.slots.captain).toEqual(['c20', 'c7']);
    expect(a.slots.captain).toEqual(['c8']);
    expect(b.direction).toBe('مدينة نصر');
    expect(a.direction).toBeNull();
    expect(after.last?.refused).toEqual([
      { from: 'a', item: personItem('c8'), reason: 'captainFull' },
    ]);
    // The tags: against the rows the window opened on.
    const tags = swapArrivals({ a: V213, b: V255 }, { a, b });
    expect([...tags.b].sort()).toEqual([fieldItem('direction'), personItem('c7')]);
    // The ticks cleared; one step to take back; the arrow held.
    expect(after.picks).toEqual({ a: [], b: [] });
    expect(after.steps).toHaveLength(1);
    expect(after.held).toBe('aToB');
    // Round 34 D critic — counted against the opening: the two tags on 255, and 255's own
    // direction, on neither row now («بدلًا من التجمع الخامس»).
    expect(swapWindowCounts(OPENING, w.rows(), after)).toEqual({ moved: 2, replaced: 1, kept: 1 });
  });

  it('several moves in a row — each works on what the one before left', () => {
    const w = session();
    w.tick('a', personItem('c7'));
    w.press('aToB');
    w.settle();
    // 255 sends 0200026 and the leave-taker 0100020: he stays (on leave), 0200026 crosses.
    w.tick('b', personItem('s26'));
    w.tick('b', personItem('c20'));
    const second = w.press('bToA');
    const { a, b } = w.rows();
    expect(a.slots.specialist1).toEqual(['s12', 's26']);
    expect(b.slots.captain).toEqual(['c20', 'c7']);
    expect(second.last?.refused).toEqual([
      { from: 'b', item: personItem('c20'), reason: 'onLeave' },
    ]);
    expect(second.steps.map((step) => step.mode)).toEqual(['aToB', 'bToA']);
    expect(swapWindowCounts(OPENING, w.rows(), second)).toEqual({
      moved: 2,
      replaced: 0,
      kept: 1,
    });
    // And the swap, both ways at once.
    w.settle();
    w.tick('a', personItem('c8'));
    w.tick('b', personItem('c7'));
    w.press('swap');
    expect(w.rows().a.slots.captain).toEqual(['c7']);
    expect(w.rows().b.slots.captain).toEqual(['c20', 'c8']);
    expect(w.state.held).toBe('swap');
  });

  // Round 34 D critic — REWRITTEN: «a press that moves nothing (everything kept back) is no step —
  // but says why». Its ticks cleared too, and there was no step for the undo to give them back.
  it('a press that moves nothing (everything kept back) is no step — says why, and its ticks stay', () => {
    const w = session();
    w.tick('a', personItem('c7'));
    w.press('aToB');
    w.settle();
    w.tick('b', personItem('c20'));
    const after = w.press('bToA');
    expect(after.steps).toHaveLength(1);
    expect(after.last?.refused).toEqual([
      { from: 'b', item: personItem('c20'), reason: 'onLeave' },
    ]);
    expect(after.held).toBe('bToA');
    expect(after.picks).toEqual({ a: [], b: [personItem('c20')] });
    // The undo takes back the move that was made — and its ticks — not the press that made none.
    const back = w.undo();
    expect(back.steps).toEqual([]);
    expect(back.picks).toEqual({ a: [personItem('c7')], b: [] });
  });

  // Round 34 D critic — a one-way press cleared the RECEIVING card's ticks too, which that arrow
  // neither read nor moved.
  it('a one-way press clears the ticks it read; the receiving card keeps its own — but a field that took the value arriving', () => {
    const w = session();
    w.tick('a', personItem('c7'));
    w.tick('b', personItem('s26'));
    w.tick('b', fieldItem('plannedTime'));
    const first = w.press('aToB');
    expect(w.rows().b.slots.captain).toEqual(['c20', 'c7']);
    expect(first.picks).toEqual({ a: [], b: [personItem('s26'), fieldItem('plannedTime')] });
    w.settle();
    // 213's time goes onto 255's: 255's «التوقيت» now holds 07:30, not the 07:45 that was ticked.
    w.tick('a', fieldItem('plannedTime'));
    const second = w.press('aToB');
    expect(w.rows().b.plannedTime).toBe('07:30');
    expect(second.picks).toEqual({ a: [], b: [personItem('s26')] });
    w.settle();
    // What stayed ticked goes on the next press of the other way.
    const third = w.press('bToA');
    expect(third.steps).toHaveLength(3);
    expect(w.rows().a.slots.specialist1).toEqual(['s12', 's26']);
    expect(third.picks).toEqual({ a: [], b: [] });
    // The swap reads both cards: both clear.
    w.settle();
    w.tick('a', personItem('s26'));
    w.tick('b', personItem('c7'));
    expect(w.press('swap').picks).toEqual({ a: [], b: [] });
    // The undo gives back the ticks of both cards as they were before that press.
    w.undo();
    expect(w.state.picks).toEqual({ a: [personItem('s26')], b: [personItem('c7')] });
  });

  it('«تراجع عن آخر نقل»: one move back at a time, its ticks back as they were — down to the opening', () => {
    const w = session();
    w.tick('a', personItem('c7'));
    w.press('aToB');
    w.settle();
    w.tick('b', personItem('s26'));
    w.press('bToA');
    // Undone while it still plays: the hold ends with it.
    const once = w.undo();
    expect(once.held).toBeNull();
    expect(once.last).toBeNull();
    expect(once.steps).toHaveLength(1);
    expect(once.picks).toEqual({ a: [], b: [personItem('s26')] });
    expect(w.rows().b.slots.specialist1).toEqual(['s26']);
    const twice = w.undo();
    expect(twice.steps).toEqual([]);
    expect(twice.picks).toEqual({ a: [personItem('c7')], b: [] });
    expect(w.rows().a).toBe(V213);
    expect(w.rows().b).toBe(V255);
    // Nothing left to take back: the same state.
    expect(w.undo()).toBe(twice);
  });

  it('another second van: the first card’s ticks kept, every move and tick of the other gone', () => {
    const start: SwapWindowState = {
      picks: { a: [personItem('c7')], b: [personItem('s26')] },
      steps: [{ mode: 'aToB', picks: { a: [personItem('c8')], b: [] } }],
      last: { mode: 'aToB', moved: [], refused: [] },
      held: 'aToB',
      closing: false,
    };
    expect(swapWindowReducer(start, { type: 'second' })).toEqual({
      ...SWAP_WINDOW_START,
      picks: { a: [personItem('c7')], b: [] },
    });
    const quiet = { ...SWAP_WINDOW_START, picks: { a: [personItem('c7')], b: [] } };
    expect(swapWindowReducer(quiet, { type: 'second' })).toBe(quiet);
  });

  it('«الكل» · «الطاقم فقط» · «لا شيء» tick one card as the card shows the row', () => {
    const all = swapWindowReducer(SWAP_WINDOW_START, {
      type: 'quick',
      side: 'b',
      row: V255,
      pick: 'crew',
    });
    expect(all.picks).toEqual({ a: [], b: [personItem('c20'), personItem('s26')] });
    expect(
      swapWindowReducer(all, { type: 'quick', side: 'b', row: V255, pick: 'none' }).picks.b,
    ).toEqual([]);
  });
});

describe('Round 34 D — why an arrow cannot act', () => {
  const rows = { a: V213, b: V255 };
  const ticked = (a: readonly string[], b: readonly string[] = []): SwapWindowState => ({
    ...SWAP_WINDOW_START,
    picks: { a, b },
  });

  it('no second van yet; a move still playing; nothing ticked on the card(s) it sends from', () => {
    expect(swapArrowWhy(ticked([personItem('c7')]), 'aToB', null)).toBe('pickSecond');
    expect(swapArrowWhy({ ...ticked([personItem('c7')]), held: 'swap' }, 'aToB', rows)).toBe(
      'playing',
    );
    // «من 213 إلى 255» reads 213's ticks only; «من 255 إلى 213» 255's; the swap either card's.
    const onA = ticked([personItem('c7')]);
    expect(swapArrowWhy(onA, 'aToB', rows)).toBeNull();
    expect(swapArrowWhy(onA, 'bToA', rows)).toBe('nothingTicked');
    expect(swapArrowWhy(onA, 'swap', rows)).toBeNull();
    const onB = ticked([], [personItem('s26')]);
    expect(swapArrowWhy(onB, 'aToB', rows)).toBe('nothingTicked');
    expect(swapArrowWhy(onB, 'swap', rows)).toBeNull();
    expect(swapArrowWhy(SWAP_WINDOW_START, 'swap', rows)).toBe('nothingTicked');
    // A tick on an item the row no longer holds counts for nothing.
    expect(swapArrowWhy(ticked([personItem('gone')]), 'aToB', rows)).toBe('nothingTicked');
  });

  it('a press the arrow cannot make changes nothing', () => {
    const state = ticked([], [personItem('s26')]);
    expect(swapWindowReducer(state, { type: 'press', mode: 'aToB', rows, rules: RULES })).toBe(
      state,
    );
    const playing = { ...ticked([personItem('c7')]), held: 'swap' as const };
    expect(swapWindowReducer(playing, { type: 'press', mode: 'aToB', rows, rules: RULES })).toBe(
      playing,
    );
  });

  it('while an arrow plays, the card(s) it sends to are the receiving ones', () => {
    expect(swapReceiving('aToB', 'b')).toBe(true);
    expect(swapReceiving('aToB', 'a')).toBe(false);
    expect(swapReceiving('bToA', 'a')).toBe(true);
    expect(swapReceiving('bToA', 'b')).toBe(false);
    expect(swapReceiving('swap', 'a')).toBe(true);
    expect(swapReceiving('swap', 'b')).toBe(true);
    expect(swapReceiving(null, 'a')).toBe(false);
  });
});

// Round 34 D critic — «نُقل: N» summed every press: there and back read «نُقل: ٢» beside
// «لم يتغيّر شيء بعد». It counts what differs from the opening, as the cards show it.
describe('Round 34 D critic — the footer counts what differs from the opening', () => {
  it('there and back is nothing; a seat changed on its own row is one; a value on neither row now is said apart', () => {
    const w = session();
    w.tick('a', personItem('c7'));
    w.press('aToB');
    w.settle();
    w.tick('b', personItem('c7'));
    const back = w.press('bToA');
    expect(back.steps).toHaveLength(2);
    expect(swapWindowCounts(OPENING, w.rows(), back)).toEqual({ moved: 0, replaced: 0, kept: 0 });
    // A field there and back: home again, but 255's own direction went in the first press.
    w.settle();
    w.tick('a', fieldItem('direction'));
    w.press('aToB');
    w.settle();
    w.tick('b', fieldItem('direction'));
    const field = w.press('bToA');
    expect(swapWindowCounts(OPENING, w.rows(), field)).toEqual({
      moved: 0,
      replaced: 1,
      kept: 0,
    });
    // No second van yet: nothing to count but what the last press kept back.
    expect(swapWindowCounts(null, null, field)).toEqual({ moved: 0, replaced: 0, kept: 0 });
    // Home in the other «أخصائي» (his own taken meanwhile) counts, as «من 255» does.
    const open = {
      a: van('213', { slots: { captain: [], specialist1: ['s12', 's14'], specialist2: [] } }),
      b: van('255', { slots: { captain: [], specialist1: ['s26'], specialist2: [] } }),
    };
    const work = {
      a: { ...open.a, slots: { captain: [], specialist1: ['s14', 's26'], specialist2: ['s12'] } },
      b: { ...open.b, slots: { captain: [], specialist1: [], specialist2: [] } },
    };
    expect(swapWindowCounts(open, work, SWAP_WINDOW_START)).toEqual({
      moved: 2,
      replaced: 0,
      kept: 0,
    });
  });
});

// Round 34 D critic — ✕, Escape and «إلغاء» dropped every move without a word.
describe('Round 34 D critic — closing with moves asks first', () => {
  it('nothing changed: close; something changed: ask; on the question: back to the window', () => {
    expect(swapCloseStep(SWAP_WINDOW_START, false)).toBe('close');
    expect(swapCloseStep(SWAP_WINDOW_START, true)).toBe('ask');
    const asking = swapWindowReducer(SWAP_WINDOW_START, { type: 'ask' });
    expect(asking.closing).toBe(true);
    expect(swapCloseStep(asking, true)).toBe('stay');
    expect(swapWindowReducer(asking, { type: 'ask' })).toBe(asking);
    const back = swapWindowReducer(asking, { type: 'stay' });
    expect(back.closing).toBe(false);
    expect(swapWindowReducer(back, { type: 'stay' })).toBe(back);
  });

  it('a press, or the undo, goes on editing: the question is gone', () => {
    const w = session();
    w.tick('a', personItem('c7'));
    w.press('aToB');
    w.settle();
    const asked = { ...w.state, closing: true, picks: { a: [personItem('c8')], b: [] } };
    const pressed = swapWindowReducer(asked, {
      type: 'press',
      mode: 'aToB',
      rows: w.rows(),
      home: OPENING,
      rules: RULES,
    });
    expect(pressed.closing).toBe(false);
    expect(swapWindowReducer({ ...w.state, closing: true }, { type: 'undo' }).closing).toBe(false);
  });
});

describe('Round 34 D — the pressed arrow stays held ~1.4s, then rests («ثانية أو ثانيتين»)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('SWAP_HOLD_MS is between 1.2s and 1.5s; the clock settles once, exactly then', () => {
    expect(SWAP_HOLD_MS).toBeGreaterThanOrEqual(1200);
    expect(SWAP_HOLD_MS).toBeLessThanOrEqual(1500);
    const settle = vi.fn();
    const clock = createSwapHoldClock(settle);
    clock.start();
    vi.advanceTimersByTime(SWAP_HOLD_MS - 1);
    expect(settle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it('a press holds the arrow, and the clock lets it go — the next press only after', () => {
    const w = session();
    const clock = createSwapHoldClock(() => w.settle());
    w.tick('a', personItem('c7'));
    w.press('aToB');
    clock.start();
    expect(w.state.held).toBe('aToB');
    // While it plays every arrow says so, and a press changes nothing.
    w.tick('b', personItem('s26'));
    expect(swapArrowWhy(w.state, 'bToA', w.rows())).toBe('playing');
    const during = w.press('bToA');
    expect(during.steps).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(w.state.held).toBe('aToB');
    vi.advanceTimersByTime(SWAP_HOLD_MS - 1000);
    expect(w.state.held).toBeNull();
    // At rest: the tick made meanwhile is still there, and the next press goes.
    expect(swapArrowWhy(w.state, 'bToA', w.rows())).toBeNull();
    w.press('bToA');
    expect(w.state.steps).toHaveLength(2);
  });

  it('`stop` drops the hold’s clock (the window closed, or the move taken back)', () => {
    const settle = vi.fn();
    const clock = createSwapHoldClock(settle);
    clock.start();
    vi.advanceTimersByTime(500);
    clock.stop();
    vi.advanceTimersByTime(SWAP_HOLD_MS);
    expect(settle).not.toHaveBeenCalled();
    // Started again, it counts from the new start.
    clock.start();
    vi.advanceTimersByTime(SWAP_HOLD_MS);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it('the glyph’s nudge and the rose flash run within the hold: 2 × 700ms = SWAP_HOLD_MS', () => {
    const config = readFileSync(
      fileURLToPath(new URL('../../../../tailwind.config.ts', import.meta.url)),
      'utf8',
    );
    for (const name of ['swap-nudge', 'swap-nudge-back', 'swap-flash']) {
      const line = new RegExp(`'${name}': '${name} (\\d+)ms [^']* (\\d+)'`).exec(config);
      expect(line, name).not.toBeNull();
      expect(Number(line?.[1]) * Number(line?.[2]), name).toBe(SWAP_HOLD_MS);
    }
  });
});

// Round 34 D critic — the press and the hold's clock were wired by hand inside the component, where
// no suite reached them: a press that never started the clock would have held every arrow for good.
// They live in `createSwapWindow` now, the window's own store, driven here with fake timers.
describe('Round 34 D critic — the window’s store: a press, its hold, and the clock let go', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const pressOf = (win: ReturnType<typeof createSwapWindow>, mode: SwapStep['mode']) => {
    const replay = replaySwap(V213, V255, win.getState().steps, RULES);
    win.press({ mode, rows: { a: replay.a, b: replay.b }, home: OPENING, rules: RULES });
  };

  it('a press moves at once and holds the arrow; SWAP_HOLD_MS later every arrow can act again', () => {
    const win = createSwapWindow();
    const seen = vi.fn();
    win.subscribe(seen);
    win.send({ type: 'tick', side: 'a', id: personItem('c7') });
    pressOf(win, 'aToB');
    expect(win.getState().held).toBe('aToB');
    expect(win.getState().steps).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    win.send({ type: 'tick', side: 'b', id: personItem('s26') });
    const rows = replaySwap(V213, V255, win.getState().steps, RULES);
    expect(swapArrowWhy(win.getState(), 'bToA', rows)).toBe('playing');
    vi.advanceTimersByTime(SWAP_HOLD_MS - 1);
    expect(win.getState().held).toBe('aToB');
    vi.advanceTimersByTime(1);
    expect(win.getState().held).toBeNull();
    expect(swapArrowWhy(win.getState(), 'bToA', rows)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    // Every change told the window: the tick, the press, the tick, the end of the hold.
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it('an arrow that cannot act changes nothing and starts no clock', () => {
    const win = createSwapWindow();
    const before = win.getState();
    pressOf(win, 'aToB');
    expect(win.getState()).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the undo ends a hold still playing; the window closing (its last watcher gone) stops the clock', () => {
    const win = createSwapWindow();
    const stop = win.subscribe(() => undefined);
    win.send({ type: 'tick', side: 'a', id: personItem('c7') });
    pressOf(win, 'aToB');
    win.undo();
    expect(win.getState().held).toBeNull();
    expect(win.getState().steps).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    // Pressed again, then the window goes: no timer left behind, no settle after it.
    pressOf(win, 'aToB');
    expect(vi.getTimerCount()).toBe(1);
    const second = win.subscribe(() => undefined);
    second();
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(SWAP_HOLD_MS * 2);
    expect(win.getState().held).toBe('aToB');
  });
});
