// Both navigation shells read the same groups, from the same component.
//
// There are two shells — `launchpad` and `rail` — and the preference that picks between them is
// presentation only. That is the whole contract: the same navigation data, arranged two ways.
// It was not being kept. The rail's page panel rendered `module.apps` alone, so a page filed in a
// section did not appear there AT ALL, and a module that had organized every one of its pages
// showed an empty column; its module list filtered on the same field, so such a module could drop
// out of the rail entirely.
//
// The fix was to render groups through the one component both shells now share, rather than to
// teach the rail a second way of grouping. These assertions are what keep it one component: a
// second implementation is exactly how the two shells drifted apart the first time.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const SIDEBAR = stripComments(read('./Sidebar.tsx'));
const RAIL = stripComments(read('./SidebarRail.tsx'));
const ROWS = stripComments(read('./nav-rows.tsx'));

describe('one group component, shared', () => {
  it('lives in the shared rows module, and nowhere else', () => {
    expect(ROWS).toContain('export const NavSectionGroup');
    // Neither shell may declare its own.
    expect(SIDEBAR).not.toContain('const NavSectionGroup = ');
    expect(RAIL).not.toContain('const NavSectionGroup = ');
  });

  it('and both shells import it rather than reimplementing it', () => {
    for (const [name, source] of [
      ['Sidebar', SIDEBAR],
      ['SidebarRail', RAIL],
    ] as const) {
      expect(source, name).toMatch(/import \{[^}]*NavSectionGroup[^}]*\} from '\.\/nav-rows'/);
    }
  });
});

describe('both shells render a module the same way', () => {
  // Ungrouped rows at the module's top level, then the groups. A page with no section has always
  // rendered directly under its module, and that is what keeps a pre-sections install working.
  it('ungrouped rows first, then every section', () => {
    // Scoped to the PANEL each shell draws — `Sidebar.tsx` also reads `current.sections` earlier,
    // to order the icons-only strip, and that use says nothing about the panel's layout.
    for (const [name, source, apps] of [
      ['Sidebar', SIDEBAR.slice(SIDEBAR.indexOf('const NavShell')), 'current'],
      ['SidebarRail', RAIL.slice(RAIL.indexOf('const ModulePanel')), 'module'],
    ] as const) {
      const appsAt = source.indexOf(`${apps}.apps.map(`);
      const sectionsAt = source.indexOf(`${apps}.sections.map(`);
      expect(appsAt, `${name}: renders ungrouped rows`).toBeGreaterThan(-1);
      expect(sectionsAt, `${name}: renders sections`).toBeGreaterThan(-1);
      expect(sectionsAt, `${name}: sections come after`).toBeGreaterThan(appsAt);
    }
  });

  /**
   * A module counts as present when it has ANY page, grouped or not.
   *
   * `m.apps.length > 0` was the rail's test, and it is the reason a fully-organized module could
   * disappear: every one of its pages was in a section, so its ungrouped list was empty.
   */
  it('and a module with only grouped pages is not filtered away', () => {
    expect(RAIL).toContain('moduleApps(m).length > 0');
    expect(RAIL).not.toContain('m.apps.length > 0');
  });
});

describe('the icons-only strip keeps every page reachable', () => {
  // A section has no icon to render, and inventing one for a 40px strip would be a schema
  // decision. The strip shows the pages and separates the groups — no page is hidden behind a
  // heading that cannot be drawn.
  it('renders each group in order, divided, with nothing dropped', () => {
    expect(SIDEBAR).toContain('const stripGroups = [current.apps, ...current.sections.map((section) => section.apps)]');
    expect(SIDEBAR).toContain('{index > 0 && <div className="my-1 h-px w-6');
  });

  it('and the exact-match set still covers every page in the module', () => {
    expect(SIDEBAR).toContain('const moduleRoutes = stripGroups.flat().map((a) => a.route);');
  });
});

describe('what the shared component still guarantees', () => {
  const GROUP = ROWS.slice(ROWS.indexOf('export const NavSectionGroup'));

  it('a collapsible heading that reports its state', () => {
    expect(GROUP).toContain('aria-expanded={expanded}');
    expect(GROUP).toContain('onClick={() => setOpen((v) => !v)}');
  });

  // Now guaranteed in BOTH shells, because both use this one component.
  it('force-expands the group holding the active route', () => {
    expect(GROUP).toContain('const expanded = open || holdsCurrent;');
    expect(GROUP).toContain('pathname === a.route || pathname.startsWith(`${a.route}/`)');
  });

  it('turns its chevron the right way in RTL, and invents no badge', () => {
    expect(GROUP).toContain('rtl:rotate-90');
    expect(GROUP).not.toContain('badge');
  });

  // Moved here when the component did (#205), rather than left behind in a second file asserting
  // the same contract against the file it used to live in.
  it('shows the group’s own name, in the reader’s locale', () => {
    expect(GROUP).toContain('localized(section.name, locale)');
  });

  it('and renders its rows only while expanded', () => {
    expect(GROUP).toContain('{expanded && (');
  });
});
