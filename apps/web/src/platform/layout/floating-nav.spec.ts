// The navigation panel floats over the page on hover, and docks into the layout once pinned
// (floating-nav.ts).
//
// The rules are a plain reducer and a few DOM helpers, tested here as functions; how the hook and
// the two shells are wired to them is checked against their source (comments stripped, so a
// sentence in a comment can never satisfy an assertion), the way the other shell specs here do
// it — this suite runs in node and renders no React.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HOVER_CLOSE_DELAY_MS,
  HOVER_OPEN_DELAY_MS,
  NAV_PINNED_KEY,
  counterpart,
  crossesEdge,
  focusInside,
  homeOf,
  hoverDelay,
  initialNavState,
  keyboardFocus,
  loadNavPinned,
  navPanelMode,
  navReducer,
  persistNavPinned,
  type NavState,
} from './floating-nav';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const LAUNCHPAD = code(read('Sidebar.tsx'));
const RAIL = code(read('SidebarRail.tsx'));
const TOPBAR = code(read('Topbar.tsx'));
const PIN = code(read('NavPinButton.tsx'));
const HOOK = code(read('floating-nav.ts'));
const ROWS = code(read('nav-rows.tsx'));
const I18N = read('../localization/i18n.ts');

const state = (over: Partial<NavState> = {}): NavState => ({ ...initialNavState(false), ...over });

describe('how the panel is drawn', () => {
  it('nothing on the strip and nothing pinned: hidden', () => {
    expect(navPanelMode(state())).toBe('hidden');
  });

  it('the pointer, the keyboard focus or a hold floats it over the page', () => {
    expect(navPanelMode(state({ pointer: true }))).toBe('floating');
    expect(navPanelMode(state({ focused: true }))).toBe('floating');
    // The module launchpad opened from inside the panel keeps it, or the launchpad would vanish
    // with the panel the moment the pointer moved onto it.
    expect(navPanelMode(state({ held: true }))).toBe('floating');
  });

  it('pinned: docked in the layout, whatever the pointer, the focus or a hold do', () => {
    // «لما اعمل تثبيت يبقى موجود بس يلخد من الحايز عادى»
    for (const pointer of [false, true]) {
      for (const focused of [false, true]) {
        for (const held of [false, true]) {
          expect(navPanelMode(state({ pinned: true, pointer, focused, held }))).toBe('docked');
        }
      }
    }
  });

  it('opens after a short pause and lingers a little longer, so a passing pointer does not flash it', () => {
    expect(HOVER_OPEN_DELAY_MS).toBeGreaterThan(0);
    expect(HOVER_CLOSE_DELAY_MS).toBeGreaterThan(HOVER_OPEN_DELAY_MS);
    expect(HOVER_CLOSE_DELAY_MS).toBeLessThanOrEqual(400);
    expect(hoverDelay(true)).toBe(HOVER_OPEN_DELAY_MS);
    expect(hoverDelay(false)).toBe(HOVER_CLOSE_DELAY_MS);
  });
});

describe('the rules (navReducer)', () => {
  it('starts with nothing on it, pinned or not as remembered', () => {
    expect(initialNavState(false)).toEqual({
      pinned: false,
      pointer: false,
      focused: false,
      held: false,
    });
    expect(initialNavState(true).pinned).toBe(true);
  });

  it('the pointer and the focus each come and go on their own', () => {
    const s1 = navReducer(state(), { type: 'pointer', on: true });
    const s2 = navReducer(s1, { type: 'focus', on: true });
    const s3 = navReducer(s2, { type: 'pointer', on: false });
    // The pointer left, the focus did not: still floating.
    expect(navPanelMode(s3)).toBe('floating');
    expect(navPanelMode(navReducer(s3, { type: 'focus', on: false }))).toBe('hidden');
  });

  it('a change to nothing returns the same state, so the shell does not re-render', () => {
    const s = state({ pointer: true });
    expect(navReducer(s, { type: 'pointer', on: true })).toBe(s);
    expect(navReducer(s, { type: 'focus', on: false })).toBe(s);
    expect(navReducer(s, { type: 'release' })).toBe(s);
  });

  it('Escape closes a panel the pointer or the focus floated', () => {
    const s = navReducer(state({ pointer: true, focused: true }), { type: 'escape' });
    expect(navPanelMode(s)).toBe('hidden');
  });

  it('…but not a pinned panel, nor one held under the launchpad (Escape closes the launchpad first)', () => {
    const pinned = state({ pinned: true, pointer: true });
    expect(navReducer(pinned, { type: 'escape' })).toBe(pinned);
    const held = state({ held: true, pointer: true });
    expect(navReducer(held, { type: 'escape' })).toBe(held);
  });

  it('a hold keeps the panel floating with neither the pointer nor the focus on it, until released', () => {
    const held = navReducer(state(), { type: 'hold' });
    expect(navPanelMode(held)).toBe('floating');
    expect(navPanelMode(navReducer(held, { type: 'release' }))).toBe('hidden');
  });

  it('the pin docks the panel and undocks it', () => {
    const docked = navReducer(state({ pointer: true }), { type: 'toggle', byPointer: true });
    expect(navPanelMode(docked)).toBe('docked');
    expect(navPanelMode(navReducer(docked, { type: 'toggle', byPointer: true }))).toBe('floating');
  });

  it('unpinned by a pointer press, the panel floats on under it even before the hover delay ran out', () => {
    // A quick move-and-click, or a tap: the open timer has not fired, so `pointer` is still false.
    const docked = state({ pinned: true });
    const after = navReducer(docked, { type: 'toggle', byPointer: true });
    expect(after.pinned).toBe(false);
    expect(navPanelMode(after)).toBe('floating');
  });

  it('unpinned from the keyboard, the focus keeps it floating; with nothing on it, it hides', () => {
    const byKey = navReducer(state({ pinned: true, focused: true }), {
      type: 'toggle',
      byPointer: false,
    });
    expect(navPanelMode(byKey)).toBe('floating');
    const nothing = navReducer(state({ pinned: true }), { type: 'toggle', byPointer: false });
    expect(navPanelMode(nothing)).toBe('hidden');
  });

  it('pinning does not invent a pointer', () => {
    const s = navReducer(state({ focused: true }), { type: 'toggle', byPointer: false });
    expect(s).toEqual({ pinned: true, pointer: false, focused: true, held: false });
  });
});

describe('reading the DOM', () => {
  // This suite has no DOM; the checks need only `instanceof`, `contains` and `matches`.
  const globals = globalThis as { Node?: unknown; Element?: unknown };
  const original = { Node: globals.Node, Element: globals.Element };
  class FakeElement {
    constructor(
      private readonly kids: readonly unknown[] = [],
      private readonly visibleFocus: boolean | 'throws' = false,
    ) {}
    contains(other: unknown): boolean {
      return (
        other === this || this.kids.some((kid) => kid instanceof FakeElement && kid.contains(other))
      );
    }
    matches(selector: string): boolean {
      if (this.visibleFocus === 'throws') throw new Error('unsupported selector');
      return selector === ':focus-visible' && this.visibleFocus;
    }
  }
  beforeEach(() => {
    globals.Node = FakeElement;
    globals.Element = FakeElement;
  });
  afterEach(() => {
    globals.Node = original.Node;
    globals.Element = original.Element;
  });

  // The fakes stand in for DOM elements; the casts only satisfy the DOM types of the signatures.
  const el = (...args: ConstructorParameters<typeof FakeElement>): Element =>
    new FakeElement(...args) as unknown as Element;

  it('counts what is inside the strip or the panel, not what is inside a portal opened from them', () => {
    const pin = el();
    const box = el([el([pin])]);
    const launchpadCard = el();
    expect(focusInside(box, pin)).toBe(true);
    // React hands a portal's events to its React parents; in the DOM it is elsewhere.
    expect(focusInside(box, launchpadCard)).toBe(false);
    expect(focusInside(box, null)).toBe(false);
  });

  it('only a crossing of the box’s own edge is entering or leaving', () => {
    const strip = el();
    const pin = el();
    const box = el([strip, el([pin])]);
    const page = el();
    const launchpadCard = el();
    expect(crossesEdge(box, strip, page)).toBe(true); // from the page onto the strip, or back
    expect(crossesEdge(box, pin, null)).toBe(true); // out of the window
    expect(crossesEdge(box, strip, pin)).toBe(false); // strip → panel is not leaving
    // A portal's mouseover, bubbled up by React with its target outside the box, is neither: it
    // must not open the panel, or the panel stays open after the launchpad closes far away.
    expect(crossesEdge(box, launchpadCard, page)).toBe(false);
    expect(crossesEdge(box, launchpadCard, strip)).toBe(false);
  });

  it('opens for keyboard focus only: a click focuses what it lands on, and must not hold the panel', () => {
    expect(keyboardFocus(el([], true))).toBe(true);
    expect(keyboardFocus(el([], false))).toBe(false);
    expect(keyboardFocus(el([], 'throws'))).toBe(false);
    expect(keyboardFocus(null)).toBe(false);
  });

  it('the box’s home is its strip or rail — every child but the panel', () => {
    const child = (panel: boolean): Element =>
      ({ hasAttribute: (a: string) => panel && a === 'data-nav-panel' }) as unknown as Element;
    const strip = child(false);
    const panel = child(true);
    const box = (kids: Element[]): Element => ({ children: kids }) as unknown as Element;
    expect(homeOf(box([strip, panel]))).toBe(strip);
    expect(homeOf(box([panel, strip]))).toBe(strip);
    // Docked, the launchpad's strip is not mounted: there is no home to return to.
    expect(homeOf(box([panel]))).toBeNull();
  });
});

describe('handing the focus between the strip and the panel (counterpart)', () => {
  type Fake = { attrs: Record<string, string>; getAttribute: (k: string) => string | null };
  const node = (attrs: Record<string, string>): Fake => ({
    attrs,
    getAttribute: (k) => attrs[k] ?? null,
  });
  const within = (nodes: Fake[]): ParentNode =>
    ({
      querySelectorAll: (sel: string) =>
        sel === 'a[href]' ? nodes.filter((n) => 'href' in n.attrs) : [],
      querySelector: (sel: string) => {
        if (sel === '[aria-haspopup="dialog"]')
          return nodes.find((n) => n.attrs['aria-haspopup'] === 'dialog') ?? null;
        if (sel === '[aria-current="page"]')
          return nodes.find((n) => n.attrs['aria-current'] === 'page') ?? null;
        return nodes[0] ?? null;
      },
    }) as unknown as ParentNode;
  const as = (n: Fake): Element => n as unknown as Element;

  const switcher = node({ 'aria-haspopup': 'dialog' });
  const fleet = node({ href: '/fleet/vehicles' });
  const drivers = node({ href: '/fleet/drivers', 'aria-current': 'page' });
  const panel = within([switcher, fleet, drivers]);

  it('the same page, by its link', () => {
    expect(counterpart(as(node({ href: '/fleet/vehicles' })), panel)).toBe(fleet);
  });

  it('the module switcher for the module switcher', () => {
    expect(counterpart(as(node({ 'aria-haspopup': 'dialog' })), panel)).toBe(switcher);
  });

  it('else the current page, else the first control', () => {
    expect(counterpart(as(node({ href: '/nowhere' })), panel)).toBe(drivers);
    expect(counterpart(as(node({})), within([switcher, fleet]))).toBe(switcher);
    expect(counterpart(null, within([]))).toBeNull();
  });
});

describe('the pinned choice is remembered on this device', () => {
  const store = new Map<string, string>();
  const original = globalThis.localStorage;
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });
  afterEach(() => {
    globalThis.localStorage = original;
  });

  it('is unpinned until someone pins it', () => {
    expect(loadNavPinned()).toBe(false);
    persistNavPinned(true);
    expect(loadNavPinned()).toBe(true);
    persistNavPinned(false);
    expect(loadNavPinned()).toBe(false);
  });

  it('under a key of its own: the old in-column panel was open by default, and must not dock this one', () => {
    expect(NAV_PINNED_KEY).not.toBe('ecms.nav.panelCollapsed');
    store.set('ecms.nav.panelCollapsed', '0');
    expect(loadNavPinned()).toBe(false);
  });

  it('and a browser that blocks storage simply starts unpinned', () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadNavPinned()).toBe(false);
    expect(() => persistNavPinned(true)).not.toThrow();
  });
});

describe('the hook feeds the rules from the DOM', () => {
  it('starts from the remembered pin, and every change goes through the reducer', () => {
    expect(HOOK).toMatch(
      /useReducer\(navReducer, enabled, [^]*?initialNavState\(on && loadNavPinned\(\)\)/,
    );
    expect(HOOK).not.toContain('useState(');
    expect(HOOK).toMatch(
      /if \(state\.pinned === lastPersisted\.current\) return;\s*lastPersisted\.current = state\.pinned;\s*persistNavPinned\(state\.pinned\);\s*\}, \[state\.pinned\]\);/,
    );
    expect(HOOK).toMatch(
      /hold: useCallback\(\(\) => dispatch\(\{ type: 'hold' \}\), \[\]\),\s*release: useCallback\(\(\) => dispatch\(\{ type: 'release' \}\), \[\]\),/,
    );
  });

  it('one box, with a ref, listens for the pointer and the focus — entering and leaving read from the DOM', () => {
    expect(HOOK).toContain('hoverProps: { ref, onMouseOver, onMouseOut, onFocus, onBlur }');
    // React's mouseenter/leave treat a portal (the module launchpad) as inside the box.
    expect(HOOK).not.toContain('onMouseEnter');
    expect(HOOK).not.toContain('onMouseLeave');
    const guard = String.raw`\(e: BoundaryEvent\): void => \{\s*if \(!enabled \|\| !crossesEdge\(e\.currentTarget, e\.target, e\.relatedTarget\)\) return;`;
    expect(HOOK).toMatch(
      new RegExp(
        String.raw`const onMouseOver = useCallback\(\s*` +
          guard +
          String.raw`\s*if \(timer\.current\?\.opening === true\) return;\s*schedule\(true\);\s*\}`,
      ),
    );
    expect(HOOK).toMatch(
      new RegExp(
        String.raw`const onMouseOut = useCallback\(\s*` +
          guard +
          String.raw`\s*schedule\(false\);\s*syncFocus\(\);\s*\}`,
      ),
    );
    expect(HOOK).toMatch(
      new RegExp(
        String.raw`const onBlur = useCallback\(\s*` +
          guard +
          String.raw`\s*dispatch\(\{ type: 'focus', on: false \}\);\s*\}`,
      ),
    );
    expect(HOOK).toMatch(
      /dispatch\(\{ type: 'pointer', on: opening \}\);\s*\}, hoverDelay\(opening\)\);/,
    );
  });

  it('keyboard focus inside the box opens it — but not a focus the hook moves itself, quietly', () => {
    expect(HOOK).toMatch(
      /const onFocus = useCallback\(\s*\(e: BoundaryEvent\): void => \{\s*if \(!enabled \|\| muted\.current\) return;\s*if \(!focusInside\(e\.currentTarget, e\.target\) \|\| !keyboardFocus\(e\.target\)\) return;\s*dispatch\(\{ type: 'focus', on: true \}\);/,
    );
    expect(HOOK).toMatch(
      /const quietFocus = useCallback\(\(el: HTMLElement \| null\): void => \{\s*muted\.current = true;\s*try \{\s*el\?\.focus\(\);\s*\} finally \{\s*muted\.current = false;\s*\}\s*\}, \[\]\);/,
    );
  });

  it('a focus dropped without a blur (the focused row removed) is noticed, and closes the panel', () => {
    expect(HOOK).toMatch(
      /if \(el !== null && !el\.contains\(document\.activeElement\)\) dispatch\(\{ type: 'focus', on: false \}\);/,
    );
    expect(HOOK).toMatch(/useEffect\(\(\) => \{\s*if \(state\.focused\) syncFocus\(\);\s*\}\);/);
    expect(HOOK).toContain("document.addEventListener('focusin', syncFocus, true);");
    expect(HOOK).toContain("document.addEventListener('pointerdown', syncFocus, true);");
  });

  it('hiding brings a focus in the panel home first; the hidden panel is inert', () => {
    expect(HOOK).toMatch(
      /if \(!showing && panel\.contains\(document\.activeElement\)\) \{\s*const home = homeOf\(el\);\s*if \(home !== null\) \{\s*home\.removeAttribute\('inert'\);\s*quietFocus\(counterpart\(document\.activeElement, home\)\);\s*\}\s*\}\s*panel\.toggleAttribute\('inert', !showing\);/,
    );
  });

  it('the covered strip hands its focus to the panel, and goes inert only once the focus is out of it — after every render', () => {
    // After every render, not on a change of mode: the box is absent while the menu loads, and a
    // panel that mounted already hidden was never made inert (its links stayed in the tab order).
    // `inert` on a focused element drops the focus to <body>: the keyboard could not reach the
    // panel at all while the handover was racing a visibility transition.
    expect(HOOK).toMatch(
      /if \(showing && panel !== null && covered\.contains\(document\.activeElement\)\) \{\s*quietFocus\(counterpart\(document\.activeElement, panel\)\);\s*\}\s*covered\.toggleAttribute\('inert', showing && !covered\.contains\(document\.activeElement\)\);\s*\}\s*\}\);/,
    );
  });

  it('Escape closes a floating panel that is not held — the guard first, the timer cleared', () => {
    expect(HOOK).toMatch(
      /const onKey = \(e: KeyboardEvent\): void => \{\s*if \(e\.key !== 'Escape'\) return;\s*clearTimer\(\);\s*dispatch\(\{ type: 'escape' \}\);\s*\};/,
    );
    expect(HOOK).toMatch(/if \(mode !== 'floating' \|\| state\.held\) return undefined;/);
    expect(HOOK).toMatch(/\}, \[mode, state\.held\]\);/);
  });

  it('a launchpad closing gives the focus back quietly — to the panel’s twin when its own switcher is covered', () => {
    expect(HOOK).toMatch(
      /const covered = el\?\.closest\('\[inert\]'\) \?\? null;\s*quietFocus\(\s*covered !== null && panel !== null && !panel\.hasAttribute\('inert'\)\s*\? counterpart\(el, panel\)\s*: el,\s*\);/,
    );
  });

  it('a pointer press on the pin cancels a pending hover timer before the toggle', () => {
    expect(HOOK).toMatch(
      /if \(byPointer\) clearTimer\(\);\s*dispatch\(\{ type: 'toggle', byPointer \}\);/,
    );
  });
});

describe('on a desktop: over the page on hover, in the layout once pinned', () => {
  it.each([
    ['launchpad', LAUNCHPAD],
    ['rail', RAIL],
  ])('%s: one box, the navigation landmark, holds the strip and the panel', (name, source) => {
    expect(source, `${name} uses the shared behaviour`).toContain('useFloatingNav(collapsible)');
    expect(source).toContain("const docked = floating.mode === 'docked';");
    expect(source, `${name} listens on one labelled <nav>`).toMatch(
      /<nav\s+aria-label=\{t\('common\.menu'\)\}\s+data-nav-strip[^>]*\{\.\.\.floating\.hoverProps\}/,
    );
    expect(source).not.toContain('ecms.nav.panelCollapsed');
  });

  it.each([
    ['launchpad', LAUNCHPAD, '0'],
    ['rail', RAIL, '14'],
  ])(
    '%s: the panel is always mounted — floating over the page, in the flow when docked, transparent and inert when hidden',
    (name, source, start) => {
      // ONE element, never conditional and never keyed: a remount would unfold the folded sections,
      // scroll the list back up, and take the focus off the pin the moment it was pressed.
      expect(source.match(/data-nav-panel(?![-\w])/g), name).toHaveLength(1);
      expect(source).not.toMatch(/&&\s*\(?\s*<div\s+data-nav-panel/);
      expect(source).not.toMatch(/<div\s+data-nav-panel[^>]*\bkey=/);
      expect(source).toMatch(
        /<div\s+data-nav-panel\s+data-nav-mode=\{floating\.mode\}\s+className=\{cn\(/,
      );
      expect(source, `${name} floats only while not docked`).toMatch(
        new RegExp(
          `data-nav-panel[^]*?!docked &&\\s*'absolute inset-y-0 start-${start} z-\\[35\\]`,
        ),
      );
      expect(
        source,
        `${name} hides by opacity (and inert, set by the hook), not by unmounting`,
      ).toMatch(
        /data-nav-panel[^]*?floating\.mode === 'hidden' && 'pointer-events-none opacity-0'/,
      );
      // Never by `visibility`: its transition starts hidden, and for that frame the panel cannot
      // take the focus the strip hands it — the keyboard could not reach the panel at all.
      expect(source).not.toMatch(/\binvisible\b/);
      expect(source).not.toContain('visibility');
      // One opacity transition for every change, none replayed on unpin (an animation class would be).
      expect(source).toMatch(
        /data-nav-panel[^]*?transition-opacity duration-150[^]*?motion-reduce:transition-none/,
      );
      expect(source).not.toContain('animate-fade-in');
    },
  );

  it('launchpad: the box is the strip’s 56px, or the panel’s 240px once docked in its place', () => {
    expect(LAUNCHPAD).toContain(
      "className={cn('relative flex h-full shrink-0', docked ? 'w-60' : 'w-14')}",
    );
    // The strip stands only while the panel is not docked; it comes FIRST in the box, so its
    // coming and going does not shift the panel to another slot (and remount it). It is marked as
    // covered, so it leaves the tab order while the panel shows over it.
    expect(LAUNCHPAD).toMatch(
      /\{\.\.\.floating\.hoverProps\}\s*>\s*\{!docked && \(\s*<div\s+data-nav-covered\s+className="flex w-14 flex-col[^]*?<IconStrip[^]*?<div\s+data-nav-panel/,
    );
  });

  it('launchpad: exactly one module switcher answers Alt+M at any time — the one that can be seen', () => {
    // The panel's whenever it shows (floating over the strip, or docked in its place)…
    expect(LAUNCHPAD).toMatch(
      /<ModuleSwitcher[^/]*?shortcuts=\{shortcuts && floating\.mode !== 'hidden'\}[^]*?onClosed=\{floating\.release\}/,
    );
    // …the strip's only while the panel is hidden: under a floating panel it is inert, and a
    // launchpad raised from it would hand the focus back to a control nobody can reach.
    expect(LAUNCHPAD).toMatch(
      /<IconStrip[^/]*?shortcuts=\{shortcuts && floating\.mode === 'hidden'\}/,
    );
    // And one launchpad at a time, whichever switcher raised it.
    expect(LAUNCHPAD).toMatch(
      /if \(document\.querySelector\('\[data-module-launchpad\]'\) !== null\) return;\s*e\.preventDefault\(\);\s*raise\(\);/,
    );
    expect(LAUNCHPAD).toMatch(
      /<div\s+data-module-launchpad\s+className=\{cn\('fixed inset-0 z-\[90\]'/,
    );
    // …and the strip passes it on to its switcher, or nothing would listen at all while unpinned.
    expect(LAUNCHPAD).toMatch(
      /const IconStrip = [^]*?<ModuleSwitcher\s+modules=\{modules\}\s+current=\{current\}\s+collapsed\s+shortcuts=\{shortcuts\}\s+restoreFocus=\{restoreFocus\}/,
    );
  });

  it('launchpad: a launchpad closed from the strip gives the focus back quietly', () => {
    expect(LAUNCHPAD).toMatch(/<IconStrip[^/]*?restoreFocus=\{floating\.restoreFocus\}/);
    expect(LAUNCHPAD).toMatch(
      /if \(focusTrigger\) \{\s*if \(restoreFocus !== undefined\) restoreFocus\(triggerRef\.current\);\s*else triggerRef\.current\?\.focus\(\);/,
    );
  });

  it('rail: the rail always stands; the panel docks beside it; the desktop panel gets its pin', () => {
    expect(RAIL).toMatch(/data-nav-strip\s+className="relative flex h-full"/);
    expect(RAIL).toMatch(
      /<ModuleRail modules=\{modules\} shownId=\{current\.id\} onPick=\{pickModule\} \/>\s*<div\s+data-nav-panel/,
    );
    expect(RAIL).toMatch(/<ModulePanel[^/]*?collapsible=\{collapsible\}/);
    // The rail is beside the floating panel, not under it: nothing of it is covered.
    expect(RAIL).not.toContain('data-nav-covered');
  });

  it.each([
    ['launchpad', LAUNCHPAD, 'column'],
    ['rail', RAIL, 'rail'],
  ])(
    '%s: loading, failed or empty, the column keeps the width it has once loaded',
    (_name, source, full) => {
      expect(source).toContain(
        `const stateWidth: ColumnWidth = collapsible && !floating.pinned ? 'strip' : '${full}';`,
      );
      expect(source).toMatch(
        /if \(isLoading\) \{\s*return <StateShell width=\{stateWidth\}>\{slim \? <SlimLoading \/> : <LoadingState \/>\}<\/StateShell>;/,
      );
      expect(source).toMatch(
        /if \(isError\) \{\s*return \(\s*<StateShell width=\{stateWidth\}>\s*\{slim \? \(\s*<SlimError onRetry=/,
      );
      expect(source).toMatch(
        /if \(modules\.length === 0\) \{\s*return \(\s*<StateShell width=\{stateWidth\}>\s*\{slim \? \(\s*<SlimEmpty /,
      );
      expect(source).not.toMatch(/<StateShell>/);
    },
  );

  it('the state column comes in the three loaded widths: the strip, the launchpad panel, the rail beside its panel', () => {
    expect(ROWS).toMatch(/strip: 'w-14',\s*column: 'w-60',\s*rail: 'w-\[17\.5rem\]',/);
    expect(ROWS).toContain('COLUMN_WIDTH[width]');
  });

  it.each([
    ['launchpad', LAUNCHPAD],
    ['rail', RAIL],
  ])(
    '%s: one navigation landmark per shell — the list inside the panel is not another',
    (_name, source) => {
      expect(source).not.toMatch(/<nav className="flex-1 overflow-y-auto/);
      expect(source.match(/<nav\b/g)).toHaveLength(2); // the desktop box, and the mobile drawer's column
    },
  );

  it('the module launchpad opened from the floating panel holds it open until it closes', () => {
    expect(LAUNCHPAD).toContain('floating.hold();');
    expect(LAUNCHPAD).toContain('onClosed={floating.release}');
    expect(LAUNCHPAD).toMatch(/setOpen\(false\);\s+onClosed\?\.\(\);/);
  });

  it('the mobile drawer is left as it was: the full panel, nothing floating — its nav unnamed', () => {
    // The drawer around it is a dialog already named «القائمة»; the same name twice is read twice.
    expect(LAUNCHPAD).toMatch(
      /if \(!collapsible\) \{\s+return \(\s+<nav className="flex w-60 shrink-0 flex-col/,
    );
    expect(RAIL).toMatch(
      /if \(!collapsible\) \{\s+return \(\s+<nav className="flex">\s+<ModuleRail/,
    );
  });

  it('the top bar stays above the floating panel, so its menus open over it', () => {
    expect(TOPBAR).toContain('<header className="relative z-40 flex');
  });
});

describe('one pin at the top of the panel docks and undocks it — nothing at the bottom', () => {
  it('a toggle with ONE name that says its state with aria-pressed, in either language', () => {
    expect(PIN).toContain('data-nav-toggle');
    expect(PIN).toContain('aria-pressed={pinned}');
    // A name that flipped to "Unpin" would be read out as "Unpin the menu, pressed".
    expect(PIN).toContain("aria-label={t('nav.pinPanel')}");
    // The tooltip, for the eye, says what a press will do.
    expect(PIN).toContain("title={t(pinned ? 'nav.unpinPanel' : 'nav.pinPanel')}");
    // Its own words, not the page-favourite pin's («تثبيت» on a page row means something else).
    expect(I18N.match(/'nav\.pinPanel': /g)).toHaveLength(2);
    expect(I18N.match(/'nav\.unpinPanel': /g)).toHaveLength(2);
    expect(I18N).toContain("'nav.pinPanel': 'تثبيت القائمة'");
    expect(I18N).toContain("'nav.unpinPanel': 'إلغاء تثبيت القائمة'");
  });

  it('tells a pointer press from a key press, so an unpinned panel stays under the pointer', () => {
    expect(PIN).toContain('onClick={(e) => onToggle(e.detail > 0)}');
  });

  it('launchpad: right after the module switcher (the name and its four squares), on a desktop only', () => {
    expect(LAUNCHPAD).toMatch(
      /<ModuleSwitcher[^]*?onPick=\{pickModule\}\s*\/>\s*<\/div>\s*\{collapsible && <NavPinButton pinned=\{floating\.pinned\} onToggle=\{floating\.togglePinned\} \/>\}/,
    );
  });

  it('rail: right after the module’s name in the panel header', () => {
    expect(RAIL).toMatch(
      /\{localized\(module\.name, locale\)\}\s*<\/span>\s*<\/div>\s*\{collapsible && <NavPinButton pinned=\{pinned\} onToggle=\{onTogglePinned\} \/>\}/,
    );
    expect(RAIL).toContain('onTogglePinned={floating.togglePinned}');
  });

  it.each([
    ['launchpad', LAUNCHPAD],
    ['rail', RAIL],
  ])(
    '%s: the old expand and collapse buttons are gone, from the strip and the panel',
    (name, source) => {
      expect(source, `${name} has no toggle of its own`).not.toContain('data-nav-toggle');
      expect(source).not.toContain('onClick={floating.togglePinned}');
      expect(source).not.toContain("'nav.collapse'");
      expect(source).not.toContain("'nav.expand'");
      expect(source).not.toContain('ToggleIcon');
    },
  );

  it('the rail strip carries module icons only', () => {
    expect(RAIL).not.toContain('footer');
    expect(RAIL).toContain(
      '<ModuleRail modules={modules} shownId={current.id} onPick={pickModule} />',
    );
  });
});
