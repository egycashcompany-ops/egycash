// A module's groups have to be VISIBLE — headings somebody can fold, not an invisible ordering.
//
// This file exists because the sidebar looked flat for a long time while the code that draws
// groups was already correct. The fault was in the DATA (rows carrying no section), and the fix
// belongs on the server — but the reason it was hard to see is that nothing here stated what the
// column is supposed to look like once the data is right.
//
// So these assertions pin the rendering contract, and they are worth having even though nothing in
// this phase changed the component: they are what makes a future "simplification" of the sidebar
// fail loudly instead of quietly turning five groups back into one list.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(resolve(HERE, './Sidebar.tsx'), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const CODE = stripComments(SIDEBAR);
/** The group component, from its declaration to the end of what it returns. */
const GROUP = CODE.slice(CODE.indexOf('const NavSectionGroup'), CODE.indexOf('const NavShell'));

describe('a section renders as a group somebody can see', () => {
  it('exists at all, and the column renders one per section', () => {
    expect(GROUP.length).toBeGreaterThan(0);
    expect(CODE).toContain('current.sections.map((section) => (');
    expect(CODE).toContain('<NavSectionGroup');
  });

  // A heading, not a separator: it is a button, so it can be operated and announced.
  it('is headed by a real control that reports its own state', () => {
    expect(GROUP).toContain('<button');
    expect(GROUP).toContain('aria-expanded={expanded}');
    expect(GROUP).toContain('onClick={() => setOpen((v) => !v)}');
  });

  it('and the heading shows the group’s own name, in the reader’s locale', () => {
    expect(GROUP).toContain('localized(section.name, locale)');
  });
});

describe('the group holding the current page is never closed', () => {
  /**
   * The property, stated as the source states it: a collapsed heading must never be the reason
   * somebody cannot see where they are. `holdsCurrent` wins over the user's fold, not the other
   * way round — which is why the expression is `open || holdsCurrent` and not `open && …`.
   */
  it('force-expands on the active route', () => {
    expect(GROUP).toContain('const expanded = open || holdsCurrent;');
    expect(GROUP).toContain('pathname === a.route || pathname.startsWith(`${a.route}/`)');
  });

  it('and the rows only render while expanded', () => {
    expect(GROUP).toContain('{expanded && (');
  });
});

describe('what the column must not do', () => {
  // Ungrouped rows render above the groups — the module's own top level. A page with no section
  // has always rendered there, and that is what keeps a pre-sections install working.
  it('still renders rows that belong to no section', () => {
    expect(CODE).toContain('current.apps.map((a) => (');
  });

  // The chevron is the only directional glyph, and it flips for Arabic rather than being mirrored
  // by a second icon or a second branch.
  it('turns its chevron the right way in RTL', () => {
    expect(GROUP).toContain('rtl:rotate-90');
  });

  // Counts come from the nav-children providers (real queries). No group heading invents one.
  it('puts no badge or count on a group heading', () => {
    expect(GROUP).not.toContain('count');
    expect(GROUP).not.toContain('badge');
  });
});
