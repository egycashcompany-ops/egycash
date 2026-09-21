// The matrix, rendered for real, against the real locale catalogs and a real permission context.
//
// **What this file can and cannot check, stated up front.** The web suite runs with
// `environment: 'node'` and deliberately carries no jsdom and no testing-library
// (`vitest.config.ts`), so nothing here clicks. That is not a gap being papered over: the RULES
// behind every bulk control are pure functions in `../lib/permission-selection`, tested directly
// and exhaustively there — selecting, clearing, the locked-key exclusion in both directions, the
// tri-state, and the round trip. What is left for a render to prove is the WIRING: that the
// component asks for translation keys that exist, that a permission the actor does not hold really
// arrives at the DOM disabled, that the third checkbox state is announced and not merely drawn, and
// that search and collapse touch no selection.
//
// The last of those is proven structurally rather than by clicking, and the assertion says so.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale, type MeDto, type PageDto, type PermissionDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { RolePermissionMatrix } from './RolePermissionMatrix';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'RolePermissionMatrix.tsx'), 'utf8');

const permission = (
  key: string,
  moduleId: string,
  pageId: string | null = null,
): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? 'view',
  moduleId,
  name: { ar: `صلاحية ${key}`, en: `Permission ${key}` },
  breakGlass: false,
  pageId,
});

/**
 * Two pages under HR and none under fleet, on purpose: the fleet permission has `pageId: null`, so
 * its module renders an Other / Unassigned group — the D1 case — beside HR's real surfaces.
 */
const PAGES: PageDto[] = [
  {
    id: 'hr.employees',
    moduleId: 'hr',
    name: { en: 'Employees', ar: 'الموظفون' },
    route: '/employees',
    sortOrder: 10,
  },
  {
    id: 'hr.contracts',
    moduleId: 'hr',
    name: { en: 'Contracts', ar: 'العقود' },
    route: null,
    sortOrder: 20,
  },
];

const CATALOG: PermissionDto[] = [
  permission('employee.view', 'hr', 'hr.employees'),
  permission('employee.edit', 'hr', 'hr.employees'),
  // The out-of-reach row every case turns on, deliberately the ONLY one on its page: when the
  // editor cannot reach it, the Contracts page has nothing left to draw and goes with it.
  permission('contract.view', 'hr', 'hr.contracts'),
  // Known to the registry and deliberately unplaced — fleet's Other / Unassigned group.
  permission('fleetVehicle.view', 'fleet', null),
];

/** The actor holds everything except `contract.view` — the out-of-reach row every case turns on. */
const HELD = ['employee.view', 'employee.edit', 'fleetVehicle.view'];
/** An administrator who holds the whole registry — nothing is filtered out of his editor. */
const EVERYTHING = ['employee.view', 'employee.edit', 'contract.view', 'fleetVehicle.view'];

const me = (permissions: string[]): MeDto => ({
  id: 'u1',
  email: 'a@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  theme: 'system',
  branchId: null,
  branchIds: [],
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: false,
  external: null,
});

const render = (
  node: JSX.Element,
  { locale = 'en', permissions = HELD }: { locale?: Locale; permissions?: string[] } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const editable = (
  selected: string[],
  locale: Locale = 'en',
  permissions: string[] = HELD,
): string =>
  render(
    <RolePermissionMatrix
      catalog={CATALOG}
      pages={PAGES}
      selected={selected}
      managed="none"
      onToggle={() => undefined}
      onBulkChange={() => undefined}
    />,
    { locale, permissions },
  );

/** The same editor, opened by somebody who holds everything — nothing is filtered away. */
const fullReach = (selected: string[]): string => editable(selected, 'en', EVERYTHING);

/** Reading the role rather than editing it: no `onToggle`, and the whole registry is drawn. */
const reading = (selected: string[] = []): string =>
  render(<RolePermissionMatrix catalog={CATALOG} pages={PAGES} selected={selected} managed="none" />);

/** Every checkbox `<input>` in render order, as raw tags. */
const checkboxes = (markup: string): string[] =>
  [...markup.matchAll(/<input[^>]*type="checkbox"[^>]*\/?>/g)].map((m) => m[0]);

/**
 * One row's checkbox, found by the label it sits inside. `Checkbox` renders `<label><input …/>text`,
 * so the label is what ties an input to the permission it controls — the input tag itself carries
 * nothing identifying, and asserting by index would pass for the wrong row after any reordering.
 */
const checkboxLabelled = (markup: string, text: string): string | undefined =>
  markup
    .split('<label')
    .find((chunk) => chunk.slice(0, chunk.indexOf('</label>')).includes(text))
    ?.match(/<input[^>]*type="checkbox"[^>]*\/?>/)?.[0];

describe('the matrix renders labels that exist in both locales', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`asks for no missing key — ${locale}`, () => {
      const markup = editable(['employee.view'], locale);
      // `translate()` falls back to the key, so an unresolved label appears verbatim in the markup.
      expect(markup).not.toContain('systemAdmin.roles.matrix.');
      expect(markup).not.toContain('systemAdmin.roles.module.');
    });
  }

  it('counts over everything DRAWN, not the search’s visible slice', () => {
    // While editing, what is drawn is what this actor can act on: the 3 he holds. The 4th is a
    // permission he neither holds nor the role carries, and it is not on the screen to be counted.
    expect(editable(['employee.view'])).toContain('Selected: 1 / 3');
  });

  it('counts an orphan key the role still carries', () => {
    const markup = editable(['employee.view', 'retired.view']);
    expect(markup).toContain('Selected: 2 / 4');
    expect(markup).toContain('retired.view');
  });
});

describe('what the editor cannot act on is not drawn', () => {
  // «ادام حاجة مليش عليها اكسس مشوفهاش اصلا» — the owner's rule, and the reason this describe block
  // no longer reads «is locked in the DOM». A greyed row with a reason on it was the screen making
  // the reader prove a negative on every visit.
  it('leaves out a permission the actor neither holds nor the role carries', () => {
    const markup = editable([]);
    const boxes = checkboxes(markup);
    // select-all + 2 modules + 2 pages + the 3 permissions he holds. The 4th is absent, and so is
    // the page that existed only to carry it.
    expect(boxes).toHaveLength(8);
    expect(boxes.filter((box) => box.includes('disabled'))).toHaveLength(0);
    expect(markup).not.toContain('contract.view');
  });

  it('draws the whole registry when READING the role, because that question is different', () => {
    // No `onToggle` — the reader's mode. A reader asking what a role carries must be told all of it,
    // including the parts he could not have granted himself.
    expect(reading(['contract.view'])).toContain('contract.view');
  });

  // The rule the file header states — "still ticked, and still removable" — was not what the code
  // did: `unknown` was folded into `disabled`, so the row rendered inert and the key could never be
  // cleaned up. These two assertions are the difference, at the DOM.
  it('renders an unknown key ticked and NOT disabled, so it can be removed', () => {
    const markup = editable(['employee.view', 'retired.view']);
    // select-all + 3 modules (hr, fleet, unknown) + 3 pages + the 3 he holds + the orphan.
    expect(checkboxes(markup)).toHaveLength(11);
    const orphanBox = checkboxLabelled(markup, 'retired.view');
    expect(orphanBox, 'the orphan checkbox was not rendered').toBeDefined();
    expect(orphanBox).toContain('checked');
    expect(orphanBox).not.toContain('disabled');
  });

  it('lets the role SHED a permission its editor could never have granted', () => {
    // The server checks only what an edit ADDS, so removing one is allowed — and the screen used to
    // be stricter than the rule it exists to explain, leaving an administrator looking at a
    // permission he was allowed to remove and unable to.
    const markup = editable(['contract.view']);
    const box = checkboxLabelled(markup, 'contract.view');
    expect(box, 'the carried permission was not rendered').toBeDefined();
    expect(box).toContain('checked');
    expect(box).not.toContain('disabled');
  });

  it('locks every box when the role is managed, bulk controls included', () => {
    const markup = render(
      <RolePermissionMatrix
        catalog={CATALOG}
        pages={PAGES}
        selected={['employee.view']}
        managed="derived"
        onToggle={() => undefined}
        onBulkChange={() => undefined}
      />,
    );
    // A managed role is inert: no bulk checkbox is offered at all, at either level.
    expect(checkboxes(markup).filter((box) => !box.includes('disabled'))).toHaveLength(0);
  });
});

describe('the third checkbox state is announced, not merely drawn', () => {
  it('marks the select-all mixed when the selection is partial', () => {
    const markup = editable(['employee.view']);
    expect(markup).toContain('aria-checked="mixed"');
  });

  it('does not claim mixed when nothing is selected', () => {
    expect(editable([])).not.toContain('aria-checked="mixed"');
  });

  it('does not claim mixed when everything reachable AND unreachable is selected', () => {
    const everything = CATALOG.map((p) => p.key);
    expect(editable(everything)).not.toContain('aria-checked="mixed"');
  });
});

describe('the module panels are expanded by default and collapsible', () => {
  it('exposes each module panel with an expanded toggle', () => {
    const markup = editable([]);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-controls="module-hr"');
    expect(markup).toContain('aria-controls="module-fleet"');
  });
});

// Requirements 7 and 8 — "search does not change selection", "collapse does not change selection".
// Without a DOM these cannot be driven by clicking, so they are pinned where the property actually
// lives: the two pieces of view state are local, and neither reaches a selection call. A future
// edit that passed `search` into the bulk maths would fail here.
describe('search and collapse are display state only', () => {
  it('keeps both in local state, and hands neither to a selection call', () => {
    expect(SOURCE).toContain('const [search, setSearch] = useState');
    expect(SOURCE).toContain('const [collapsed, setCollapsed] = useState');
    // The only two ways selection changes, and what each is given.
    expect(SOURCE).toMatch(
      /onBulkChange\(applyBulk\(selected, rows, bulkIntent\([^)]*\), canGrant\)\)/,
    );
    // The search term reaches `visibleTree` and nothing else.
    expect(SOURCE).toMatch(/visibleTree\(tree, search,/);
    expect(SOURCE).toContain('onToggle?.(row.key, e.target.checked)');
    // `search` appears only in filtering and in the note; never inside a bulk call.
    expect(SOURCE).not.toMatch(/applyBulk\([^)]*search/);
    expect(SOURCE).not.toMatch(/bulkIntent\([^)]*search/);
    expect(SOURCE).not.toMatch(/(applyBulk|bulkIntent)\([^)]*collapsed/);
  });

  it('feeds every bulk control its group’s FULL row set, not the filtered one', () => {
    // `module.rows` / `entry.rows` are the whole group; `shown` is what the search left. Each bulk
    // call takes the full set, at all three levels.
    expect(SOURCE).toContain('onChange={() => bulk(module.rows)}');
    expect(SOURCE).toContain('onChange={() => bulk(entry.rows)}');
    expect(SOURCE).toContain('onChange={() => bulk(allRows)}');
    expect(SOURCE).toMatch(/shown\.map\(\(row\)/);
  });
});

describe('the payload shape is untouched', () => {
  it('hands the form a plain string list, not a new structure', () => {
    // `onBulkChange` is typed `(next: string[]) => void`; the form assigns it straight to the
    // `permissionKeys` state that the API has always received.
    expect(SOURCE).toContain('onBulkChange?: ((next: string[]) => void) | undefined;');
    const form = readFileSync(resolve(HERE, '../pages/RoleEditorPage.tsx'), 'utf8');
    expect(form).toContain('const replaceKeys = (next: string[]): void => setKeys(next);');
    expect(form).toContain('permissionKeys: keys');
  });
});

// ── The page layer (P7-B), at the DOM ───────────────────────────────────────
//
// The tree's arithmetic is proven in `../lib/matrix-tree.spec.ts` against the pure functions. What
// a render can add is that the level actually reaches the markup: that a page is drawn with its own
// control, that its third state is ANNOUNCED rather than merely drawn, that the Other bucket is
// labelled in both locales, and that `route` renders as a link without becoming a decision.

describe('the page layer reaches the DOM', () => {
  it('draws a group for each page, and one for the deliberately unassigned', () => {
    // Read mode, because that is the mode that draws the whole registry. An EDITOR is shown the
    // pages he can act on, and this actor can act on nothing the Contracts page holds.
    const markup = reading();
    expect(markup).toContain('Employees');
    expect(markup).toContain('Contracts');
    expect(markup).toContain('Other / Unassigned');
    // Each page panel is independently expandable, so each carries its own controls — and it does
    // so while reading too, where there is no checkbox to hang them on.
    expect(markup).toContain('aria-controls="page-hr-hr-employees"');
    expect(markup).toContain('aria-controls="page-hr-hr-contracts"');
    expect(markup).toContain('aria-controls="page-fleet-"');
  });

  it('drops a whole page when the editor can reach nothing on it', () => {
    // «ادام حاجة مليش عليها اكسس مشوفهاش اصلا», one level up: the page existed to carry
    // `contract.view`, so with that row gone the heading is not left standing over an empty list.
    const markup = editable([]);
    expect(markup).toContain('aria-controls="page-hr-hr-employees"');
    expect(markup).not.toContain('aria-controls="page-hr-hr-contracts"');
    expect(markup).not.toContain('Contracts');
    // …and the module above it stays, because its other page still has rows.
    expect(markup).toContain('aria-controls="module-hr"');
  });

  it('names the Other bucket in Arabic too, rather than falling back to a key', () => {
    const markup = editable([], 'ar');
    expect(markup).toContain('أخرى / غير مُسندة');
    expect(markup).not.toContain('systemAdmin.roles.matrix.');
  });

  it('renders `route` as a link, in LTR, and nowhere near a decision', () => {
    const markup = editable([]);
    expect(markup).toContain('href="/employees"');
    expect(markup).toContain('dir="ltr"');
    // The page with `route: null` gets no link — an absent route is not an empty one.
    expect(markup).not.toContain('href=""');
  });

  // The state a flat matrix could not express: one page complete, its module still partial.
  it('announces a full page and a partial module at the same time', () => {
    // An actor who holds everything, so the tree is the whole registry and the two levels can
    // disagree: the Employees page is complete while HR still has `contract.view` untouched.
    const markup = fullReach(['employee.view', 'employee.edit']);
    const employeesPage = checkboxLabelled(markup, 'Employees');
    const hrModule = checkboxLabelled(markup, 'HR');
    expect(employeesPage).toContain('checked');
    expect(employeesPage).not.toContain('aria-checked="mixed"');
    expect(hrModule).toContain('aria-checked="mixed"');
  });

  it('marks a partially selected page mixed, not checked', () => {
    const page = checkboxLabelled(editable(['employee.view']), 'Employees');
    expect(page).toContain('aria-checked="mixed"');
    expect(page).not.toContain('checked=""');
  });

  it('counts at both levels over the whole group, not the visible slice', () => {
    const markup = fullReach(['employee.view']);
    // hr: 1 of 3 across two pages · the Employees page alone: 1 of 2 · overall: 1 of 4.
    expect(markup).toContain('Selected: 1 / 3');
    expect(markup).toContain('Selected: 1 / 2');
    expect(markup).toContain('Selected: 1 / 4');
  });

  it('keeps a row’s own editability intact inside its page', () => {
    // The page layer neither loosens nor tightens the row rule. `contract.view` is out of this
    // actor's reach, so the role CARRYING it is the only way it is drawn at all — and then it is
    // live, because he is allowed to take it away (the server checks what an edit adds, not what
    // it drops). The page comes back with it, and the page's own counter says 1 / 1.
    const markup = editable(['contract.view']);
    expect(markup).toContain('aria-controls="page-hr-hr-contracts"');
    const box = checkboxLabelled(markup, 'Permission contract.view');
    expect(box, 'the carried permission was not drawn in its page').toBeDefined();
    expect(box).toContain('checked');
    expect(box).not.toContain('disabled');
    expect(markup).toContain('Selected: 1 / 1');
  });

  it('draws that same row inert when the role is only being read', () => {
    const box = checkboxLabelled(reading(['contract.view']), 'Permission contract.view');
    expect(box).toContain('disabled');
  });

  it('offers no page checkbox at all on a managed role', () => {
    const markup = render(
      <RolePermissionMatrix
        catalog={CATALOG}
        pages={PAGES}
        selected={['employee.view']}
        managed="system"
        onToggle={() => undefined}
        onBulkChange={() => undefined}
      />,
    );
    expect(checkboxes(markup).filter((box) => !box.includes('disabled'))).toHaveLength(0);
    // …and the page is still NAMED, because a read-only tree must still be readable.
    expect(markup).toContain('Employees');
  });

  it('falls back to one Other group per module when the registry sends no pages', () => {
    const markup = render(
      <RolePermissionMatrix
        catalog={CATALOG}
        selected={[]}
        managed="none"
        onToggle={() => undefined}
        onBulkChange={() => undefined}
      />,
    );
    expect(markup).toContain('Other / Unassigned');
    expect(markup).not.toContain('Employees');
  });
});
