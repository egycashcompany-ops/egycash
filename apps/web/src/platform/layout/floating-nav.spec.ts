// The navigation panel floats over the page instead of taking a column from it (floating-nav.ts).
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
  loadNavPinned,
  navPanelShown,
  persistNavPinned,
} from './floating-nav';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const LAUNCHPAD = read('Sidebar.tsx');
const RAIL = read('SidebarRail.tsx');
const TOPBAR = read('Topbar.tsx');

describe('when the floating panel is drawn', () => {
  it('pinned, hovered or held open — any one is enough', () => {
    expect(navPanelShown({ pinned: false, hovering: false, held: false })).toBe(false);
    expect(navPanelShown({ pinned: true, hovering: false, held: false })).toBe(true);
    expect(navPanelShown({ pinned: false, hovering: true, held: false })).toBe(true);
    // The module launchpad opened from inside the panel keeps it, or the launchpad would vanish
    // with the panel the moment the pointer moved onto it.
    expect(navPanelShown({ pinned: false, hovering: false, held: true })).toBe(true);
  });

  it('opens after a short pause and lingers a little longer, so a passing pointer does not flash it', () => {
    expect(HOVER_OPEN_DELAY_MS).toBeGreaterThan(0);
    expect(HOVER_CLOSE_DELAY_MS).toBeGreaterThan(HOVER_OPEN_DELAY_MS);
    expect(HOVER_CLOSE_DELAY_MS).toBeLessThanOrEqual(400);
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

  it('under a key of its own: the old in-column panel was open by default, and must not open this one', () => {
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

describe('on a desktop the panel never takes the page’s width', () => {
  it.each([
    ['launchpad', LAUNCHPAD],
    ['rail', RAIL],
  ])(
    '%s: the hover box holds the strip and the panel, and only the strip is in the layout',
    (name, source) => {
      expect(source, `${name} uses the shared behaviour`).toContain('useFloatingNav(collapsible)');
      expect(source, `${name} listens on one box`).toMatch(
        /data-nav-strip[^>]*\{\.\.\.floating\.hoverProps\}/,
      );
      // The panel is positioned over the page, not placed beside it.
      expect(source, `${name} draws the panel over the page`).toMatch(
        /floating\.shown && \(\s*<div\s+data-nav-panel\s+className=\{?[^]*?absolute inset-y-0 start-/,
      );
      expect(source).toContain('z-[35]');
      // The old in-column switch is gone: no width that depends on a collapsed flag.
      expect(source).not.toContain("collapsed ? 'w-14' : 'w-60'");
      expect(source).not.toContain('ecms.nav.panelCollapsed');
    },
  );

  it('the launchpad strip stays 56px wide, and the toggle pins the panel open', () => {
    expect(LAUNCHPAD).toContain('className="relative flex h-full w-14 shrink-0"');
    expect(LAUNCHPAD).toContain('onClick={floating.togglePinned}');
    expect(RAIL).toContain('onClick={floating.togglePinned}');
    expect(RAIL).toContain('onTogglePinned={floating.togglePinned}');
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

  it('the top bar stays above the panel, so its menus open over it', () => {
    expect(TOPBAR).toContain('<header className="relative z-40 flex');
  });
});
