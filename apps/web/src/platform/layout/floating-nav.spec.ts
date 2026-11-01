// The navigation panel floats over the page on hover, and docks into the layout once pinned
// (floating-nav.ts).
//
// The decisions are tested as functions; how the two shells are wired to them is checked against
// their source, the way the other shell specs here do it — this suite renders no React.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HOVER_CLOSE_DELAY_MS,
  HOVER_OPEN_DELAY_MS,
  NAV_PINNED_KEY,
  focusInside,
  keyboardFocus,
  loadNavPinned,
  navPanelMode,
  persistNavPinned,
} from './floating-nav';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const LAUNCHPAD = read('Sidebar.tsx');
const RAIL = read('SidebarRail.tsx');
const TOPBAR = read('Topbar.tsx');
const PIN = read('NavPinButton.tsx');
const HOOK = read('floating-nav.ts');
const I18N = read('../localization/i18n.ts');

describe('how the panel is drawn', () => {
  it('nothing on the strip and nothing pinned: hidden', () => {
    expect(navPanelMode({ pinned: false, hovering: false, held: false })).toBe('hidden');
  });

  it('hovered, focused or held open: floating over the page', () => {
    expect(navPanelMode({ pinned: false, hovering: true, held: false })).toBe('floating');
    // The module launchpad opened from inside the panel keeps it, or the launchpad would vanish
    // with the panel the moment the pointer moved onto it.
    expect(navPanelMode({ pinned: false, hovering: false, held: true })).toBe('floating');
  });

  it('pinned: docked in the layout, whatever the pointer does', () => {
    // «لما اعمل تثبيت يبقى موجود بس يلخد من الحايز عادى»
    for (const hovering of [false, true]) {
      for (const held of [false, true]) {
        expect(navPanelMode({ pinned: true, hovering, held })).toBe('docked');
      }
    }
  });

  it('opens after a short pause and lingers a little longer, so a passing pointer does not flash it', () => {
    expect(HOVER_OPEN_DELAY_MS).toBeGreaterThan(0);
    expect(HOVER_CLOSE_DELAY_MS).toBeGreaterThan(HOVER_OPEN_DELAY_MS);
    expect(HOVER_CLOSE_DELAY_MS).toBeLessThanOrEqual(400);
  });
});

describe('the keyboard reaches the panel too', () => {
  // This suite has no DOM; the two checks need only `instanceof`, `contains` and `matches`.
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

  it('counts focus inside the strip or the panel, not focus inside a portal opened from them', () => {
    const pin = el();
    const box = el([el([pin])]);
    const launchpadCard = el();
    expect(focusInside(box, pin)).toBe(true);
    // React hands a portal's focus events to its React parents; in the DOM it is elsewhere.
    expect(focusInside(box, launchpadCard)).toBe(false);
    expect(focusInside(box, null)).toBe(false);
  });

  it('opens for keyboard focus only: a click focuses what it lands on, and must not hold the panel', () => {
    expect(keyboardFocus(el([], true))).toBe(true);
    expect(keyboardFocus(el([], false))).toBe(false);
    expect(keyboardFocus(el([], 'throws'))).toBe(false);
    expect(keyboardFocus(null)).toBe(false);
  });

  it('and the pointer and the focus are wired into one box, both read from the DOM', () => {
    expect(HOOK).toContain('hoverProps: { onMouseOver, onMouseOut, onFocus, onBlur }');
    // The pointer, too, enters and leaves by the DOM: to React the launchpad portal is inside the
    // box, and a panel that never saw the pointer leave for it stayed open after it closed.
    expect(HOOK).not.toContain('onMouseEnter');
    expect(HOOK).not.toContain('onMouseLeave');
    expect(HOOK).toMatch(
      /onMouseOut = useCallback\([^]*?focusInside\(e\.currentTarget, e\.target\)[^]*?focusInside\(e\.currentTarget, e\.relatedTarget\)\) return;\s*schedule\(false\);/,
    );
    expect(HOOK).toMatch(
      /onFocus = useCallback\([^]*?focusInside\(e\.currentTarget, e\.target\)[^]*?keyboardFocus\(e\.target\)/,
    );
    expect(HOOK).toMatch(
      /onBlur = useCallback\([^]*?focusInside\(e\.currentTarget, e\.relatedTarget\)\) return;/,
    );
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

  it('is closed until someone pins it', () => {
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

  it('and a browser that blocks storage simply starts closed', () => {
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

describe('on a desktop: over the page on hover, in the layout once pinned', () => {
  it.each([
    ['launchpad', LAUNCHPAD],
    ['rail', RAIL],
  ])(
    '%s: one box holds the strip and the panel, and listens for the pointer and the focus',
    (name, source) => {
      expect(source, `${name} uses the shared behaviour`).toContain('useFloatingNav(collapsible)');
      expect(source).toContain("const docked = floating.mode === 'docked';");
      expect(source, `${name} listens on one box`).toMatch(
        /data-nav-strip[^>]*\{\.\.\.floating\.hoverProps\}/,
      );
      expect(source).not.toContain('ecms.nav.panelCollapsed');
    },
  );

  it.each([
    ['launchpad', LAUNCHPAD],
    ['rail', RAIL],
  ])(
    '%s: unpinned, the panel is positioned over the page; pinned, it is in the flow',
    (name, source) => {
      expect(source, `${name} draws the panel in either visible state`).toMatch(
        /floating\.mode !== 'hidden' && \(\s*<div\s+data-nav-panel/,
      );
      // The over-the-page placement is conditional on NOT being docked. A docked panel carries none
      // of it, so it sits in the box's flex row and the page beside it narrows.
      expect(source, `${name} floats only while not docked`).toMatch(
        /data-nav-panel\s+className=\{cn\([^]*?!docked &&\s*'absolute inset-y-0 start-(?:0|14) z-\[35\]/,
      );
    },
  );

  it.each([
    ['launchpad', LAUNCHPAD],
    ['rail', RAIL],
  ])(
    '%s: the panel is ONE element in both states, so the pin keeps the focus across a toggle',
    (name, source) => {
      expect(source.match(/data-nav-panel/g), name).toHaveLength(1);
    },
  );

  it('launchpad: the box is the strip’s 56px, or the panel’s 240px once docked in its place', () => {
    expect(LAUNCHPAD).toContain(
      "className={cn('relative flex h-full shrink-0', docked ? 'w-60' : 'w-14')}",
    );
    // The strip stands only while the panel is not docked; it comes FIRST in the box, so its
    // coming and going does not shift the panel to another slot (and remount it).
    expect(LAUNCHPAD).toMatch(
      /\{\.\.\.floating\.hoverProps\}\s*>\s*\{!docked && \(\s*<div className="flex w-14 flex-col[^]*?<IconStrip[^]*?\{floating\.mode !== 'hidden' && \(/,
    );
  });

  it('launchpad: exactly one module switcher answers Alt+M — the strip’s, or the docked panel’s', () => {
    // While the panel floats, the strip is mounted under it with its own switcher; two listeners
    // would raise two launchpads for one keystroke.
    expect(LAUNCHPAD).toMatch(
      /<ModuleSwitcher[^/]*?shortcuts=\{shortcuts && docked\}[^]*?onClosed=\{floating\.release\}/,
    );
    expect(LAUNCHPAD).toMatch(/<IconStrip[^/]*?shortcuts=\{shortcuts\}/);
  });

  it('rail: the rail always stands; the panel docks beside it', () => {
    expect(RAIL).toContain('className="relative flex h-full"');
    expect(RAIL).toMatch(
      /<ModuleRail modules=\{modules\} shownId=\{current\.id\} onPick=\{pickModule\} \/>\s*\{floating\.mode !== 'hidden'/,
    );
  });

  it('the module launchpad opened from the floating panel holds it open until it closes', () => {
    expect(LAUNCHPAD).toContain('floating.hold();');
    expect(LAUNCHPAD).toContain('onClosed={floating.release}');
    expect(LAUNCHPAD).toMatch(/setOpen\(false\);\s+onClosed\?\.\(\);/);
  });

  it('the mobile drawer is left as it was: the full panel, nothing floating', () => {
    expect(LAUNCHPAD).toMatch(
      /if \(!collapsible\) \{\s+return \(\s+<div className="flex w-60 shrink-0 flex-col/,
    );
    expect(RAIL).toMatch(
      /if \(!collapsible\) \{\s+return \(\s+<div className="flex">\s+<ModuleRail/,
    );
  });

  it('the top bar stays above the floating panel, so its menus open over it', () => {
    expect(TOPBAR).toContain('<header className="relative z-40 flex');
  });
});

describe('one pin at the top of the panel opens and closes it — nothing at the bottom', () => {
  it('the pin is a toggle that says which way it is set, in either language', () => {
    expect(PIN).toContain('data-nav-toggle');
    expect(PIN).toContain('aria-pressed={pinned}');
    expect(PIN).toContain("t(pinned ? 'nav.unpinPanel' : 'nav.pinPanel')");
    // Its own words, not the page-favourite pin's («تثبيت» on a page row means something else).
    expect(I18N.match(/'nav\.pinPanel': /g)).toHaveLength(2);
    expect(I18N.match(/'nav\.unpinPanel': /g)).toHaveLength(2);
    expect(I18N).toContain("'nav.pinPanel': 'تثبيت القائمة'");
    expect(I18N).toContain("'nav.unpinPanel': 'إلغاء تثبيت القائمة'");
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
