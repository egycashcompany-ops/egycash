// Round 34 E — the toolbar's totals scroll sideways inside their own box when the catalog outgrows the
// room: which edge hides chips, what a wheel does, and the fade. Round 34 critic — a chip reached by
// Tab brought clear of the edge and its fade, and the listeners themselves (`followSide`) driven on a
// stand-in box: the suite has no DOM, and Node's own events are enough.
import { describe, expect, it } from 'vitest';
import {
  NO_EDGES,
  SIDE_FADE,
  followSide,
  sideEdges,
  sideFade,
  sideReveal,
  wheelToSide,
  type SideEdges,
} from './side-scroll';

describe('Round 34 E — the totals’ line: which edge hides chips', () => {
  it('nothing hidden when the line fits its box', () => {
    expect(sideEdges({ scrollLeft: 0, scrollWidth: 957, clientWidth: 957 })).toEqual(NO_EDGES);
  });

  it('left to right: 0 at the start, positive toward the end', () => {
    const box = { scrollWidth: 948, clientWidth: 871 };
    expect(sideEdges({ ...box, scrollLeft: 0 })).toEqual({ start: false, end: true });
    expect(sideEdges({ ...box, scrollLeft: 40 })).toEqual({ start: true, end: true });
    expect(sideEdges({ ...box, scrollLeft: 77 })).toEqual({ start: true, end: false });
  });

  it('right to left (Arabic): 0 at the start, NEGATIVE toward the end — read as a distance', () => {
    const box = { scrollWidth: 948, clientWidth: 871 };
    expect(sideEdges({ ...box, scrollLeft: 0 })).toEqual({ start: false, end: true });
    expect(sideEdges({ ...box, scrollLeft: -40 })).toEqual({ start: true, end: true });
    expect(sideEdges({ ...box, scrollLeft: -77 })).toEqual({ start: true, end: false });
  });

  it('a pixel of slack on each side: zoom draws fractions', () => {
    expect(sideEdges({ scrollLeft: -0.6, scrollWidth: 958, clientWidth: 957 })).toEqual(NO_EDGES);
    expect(sideEdges({ scrollLeft: 0, scrollWidth: 958.5, clientWidth: 957 })).toEqual({
      start: false,
      end: true,
    });
  });
});

describe('Round 34 E — a plain wheel moves the line; a sideways one and the edges are the browser’s', () => {
  const middle = { start: true, end: true };

  it('down is toward the end — rightwards in English, leftwards (negative) in Arabic', () => {
    expect(wheelToSide({ deltaX: 0, deltaY: 100 }, middle, false)).toBe(100);
    expect(wheelToSide({ deltaX: 0, deltaY: 100 }, middle, true)).toBe(-100);
    expect(wheelToSide({ deltaX: 0, deltaY: -60 }, middle, false)).toBe(-60);
    expect(wheelToSide({ deltaX: 0, deltaY: -60 }, middle, true)).toBe(60);
  });

  it('at the end, down goes to the page; at the start, up does', () => {
    expect(wheelToSide({ deltaX: 0, deltaY: 100 }, { start: true, end: false }, true)).toBeNull();
    expect(wheelToSide({ deltaX: 0, deltaY: -100 }, { start: false, end: true }, true)).toBeNull();
    // A line that fits moves nothing, whichever way.
    expect(wheelToSide({ deltaX: 0, deltaY: 100 }, NO_EDGES, false)).toBeNull();
    expect(wheelToSide({ deltaX: 0, deltaY: -100 }, NO_EDGES, false)).toBeNull();
  });

  it('a trackpad’s sideways swipe already moves the box: left to the browser', () => {
    expect(wheelToSide({ deltaX: 80, deltaY: 10 }, middle, true)).toBeNull();
    expect(wheelToSide({ deltaX: 50, deltaY: 50 }, middle, false)).toBeNull();
    expect(wheelToSide({ deltaX: 0, deltaY: 0 }, middle, false)).toBeNull();
  });
});

describe('Round 34 E — the fade over the edge that hides chips', () => {
  it('no fade while the line fits', () => {
    expect(sideFade(NO_EDGES, true)).toBeUndefined();
    expect(sideFade(NO_EDGES, false)).toBeUndefined();
  });

  it('Arabic: chips past the end fade on the LEFT; back from the start, on the RIGHT', () => {
    expect(sideFade({ start: false, end: true }, true)).toBe(
      'linear-gradient(to right, transparent 0, #000 28px, #000 100%)',
    );
    expect(sideFade({ start: true, end: false }, true)).toBe(
      'linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%)',
    );
  });

  it('English: the end is on the right', () => {
    expect(sideFade({ start: false, end: true }, false)).toBe(
      'linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%)',
    );
    expect(sideFade({ start: true, end: true }, false)).toBe(
      'linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)',
    );
  });
});

// Round 34 critic — «a chip reached by Tab comes into view» was claimed and not so: Chromium leaves a
// PARTLY seen focused chip where it is, and at 1280 in English «Emergency» stood 76 of its 89px past
// the box's edge, the rest under the fade. Now the box brings it whole inside, clear of the fade.
describe('Round 34 critic — a chip reached by Tab stands whole inside the box, clear of the fade', () => {
  const box = { left: 88, right: 975 };

  it('past the end edge (English): moved left until it clears the fade — the critic’s «Emergency»', () => {
    // 962..1051 against 88..975: 76px past the edge, + the 28px fade.
    expect(sideReveal(box, { left: 962, right: 1051 }, false)).toBe(1051 - (975 - SIDE_FADE));
  });

  it('before the start edge (Arabic, the strip scrolled to its end): moved right, clear of the fade', () => {
    expect(sideReveal({ left: 16, right: 374 }, { left: -39, right: 32 }, true)).toBe(
      -39 - (16 + 28),
    );
  });

  it('already whole and clear: nothing moves', () => {
    expect(sideReveal(box, { left: 200, right: 290 }, false)).toBe(0);
    expect(sideReveal(box, { left: 116, right: 947 - 1 }, true)).toBe(0);
  });

  it('wider than the room: its reading start in sight — the left in English, the right in Arabic', () => {
    const narrow = { left: 0, right: 100 };
    expect(sideReveal(narrow, { left: 60, right: 160 }, false)).toBe(60 - 28);
    expect(sideReveal(narrow, { left: -90, right: 10 }, true)).toBe(10 - (100 - 28));
  });
});

/** A stand-in for the strip: its chips sit at `at[i] - scrollLeft`, as a scrolling box draws them. */
class FakeStrip extends EventTarget {
  scrollLeft = 0;
  readonly scrollWidth = 1141;
  readonly clientWidth = 887;
  readonly children: Element[] = [];
  getBoundingClientRect(): { left: number; right: number } {
    return { left: 88, right: 975 };
  }
  chip(left: number, width: number, keyboard = true) {
    return {
      getBoundingClientRect: () => ({
        left: left - this.scrollLeft,
        right: left + width - this.scrollLeft,
      }),
      matches: (selector: string) => selector === ':focus-visible' && keyboard,
    };
  }
}
const focusOn = (strip: FakeStrip, chip: object): void => {
  const event = new Event('focusin', { bubbles: true });
  Object.defineProperty(event, 'target', { value: chip });
  strip.dispatchEvent(event);
};

describe('Round 34 critic — the strip’s listeners (`followSide`): Tab, the wheel, the edges', () => {
  it('Tab onto a chip past the edge scrolls the strip until it stands clear, and says the new edges', () => {
    const strip = new FakeStrip();
    const told: SideEdges[] = [];
    const stop = followSide(strip, { onEdges: (edges) => told.push(edges), rtl: () => false });
    expect(told.at(-1)).toEqual({ start: false, end: true });
    const emergency = strip.chip(962, 89);
    focusOn(strip, emergency);
    expect(strip.scrollLeft).toBe(104);
    const seen = emergency.getBoundingClientRect();
    expect(seen.right).toBeLessThanOrEqual(975 - SIDE_FADE);
    expect(seen.left).toBeGreaterThanOrEqual(88 + SIDE_FADE);
    expect(told.at(-1)).toEqual({ start: true, end: true });
    // A chip already in sight moves nothing.
    focusOn(strip, strip.chip(400, 80));
    expect(strip.scrollLeft).toBe(104);
    stop();
  });

  it('in Arabic the line scrolls the other way: a chip past the LEFT edge, scrollLeft negative', () => {
    const strip = new FakeStrip();
    const stop = followSide(strip, { onEdges: () => undefined, rtl: () => true });
    focusOn(strip, strip.chip(40, 70));
    expect(strip.scrollLeft).toBe(40 - (88 + SIDE_FADE));
    stop();
  });

  it('a press focuses its chip too — and the line does NOT move under the pointer (the release would miss)', () => {
    const strip = new FakeStrip();
    const stop = followSide(strip, { onEdges: () => undefined, rtl: () => false });
    focusOn(strip, strip.chip(962, 89, false));
    expect(strip.scrollLeft).toBe(0);
    stop();
  });

  it('a plain wheel over it moves it, and the page keeps the turn at the edge', () => {
    const strip = new FakeStrip();
    const stop = followSide(strip, { onEdges: () => undefined, rtl: () => false });
    const turn = (deltaY: number): boolean => {
      const event = Object.assign(new Event('wheel', { cancelable: true }), { deltaX: 0, deltaY });
      strip.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(turn(100)).toBe(true);
    expect(strip.scrollLeft).toBe(100);
    expect(turn(-100)).toBe(true);
    expect(strip.scrollLeft).toBe(0);
    // At the start, up is the page's.
    expect(turn(-100)).toBe(false);
    expect(strip.scrollLeft).toBe(0);
    stop();
  });

  it('undone: no listener left behind', () => {
    const strip = new FakeStrip();
    const stop = followSide(strip, { onEdges: () => undefined, rtl: () => false });
    stop();
    focusOn(strip, strip.chip(962, 89));
    expect(strip.scrollLeft).toBe(0);
  });
});
