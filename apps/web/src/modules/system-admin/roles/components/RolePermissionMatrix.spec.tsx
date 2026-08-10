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
import { type Locale, type MeDto, type PermissionDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { RolePermissionMatrix } from './RolePermissionMatrix';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'RolePermissionMatrix.tsx'), 'utf8');

const permission = (key: string, moduleId: string): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? 'view',
  moduleId,
  name: { ar: `صلاحية ${key}`, en: `Permission ${key}` },
  breakGlass: false,
});

const CATALOG: PermissionDto[] = [
  permission('employee.view', 'hr'),
  permission('employee.edit', 'hr'),
  permission('employee.delete', 'hr'),
  permission('fleetVehicle.view', 'fleet'),
];

/** The actor holds everything except `employee.delete` — the locked row every case turns on. */
const HELD = ['employee.view', 'employee.edit', 'fleetVehicle.view'];

const me = (permissions: string[]): MeDto => ({
  id: 'u1',
  email: 'a@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  branchId: null,
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: false,
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

const editable = (selected: string[], locale: Locale = 'en'): string =>
  render(
    <RolePermissionMatrix
      catalog={CATALOG}
      selected={selected}
      managed="none"
      onToggle={() => undefined}
      onBulkChange={() => undefined}
    />,
    { locale },
  );

/** Every checkbox `<input>` in render order, as raw tags. */
const checkboxes = (markup: string): string[] => [
  ...markup.matchAll(/<input[^>]*type="checkbox"[^>]*\/?>/g),
].map((m) => m[0]);

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

  it('shows the counter over the WHOLE registry, not the visible slice', () => {
    // 4 permissions in the catalog, 1 selected.
    expect(editable(['employee.view'])).toContain('Selected: 1 / 4');
  });

  it('counts an orphan key the role still carries', () => {
    const markup = editable(['employee.view', 'retired.view']);
    expect(markup).toContain('Selected: 2 / 5');
    expect(markup).toContain('retired.view');
  });
});

describe('a permission the actor does not hold is locked in the DOM', () => {
  it('renders that checkbox disabled and every other one enabled', () => {
    const markup = editable([]);
    const boxes = checkboxes(markup);
    // select-all + 2 module boxes + 4 permissions.
    expect(boxes).toHaveLength(7);
    expect(boxes.filter((box) => box.includes('disabled'))).toHaveLength(1);
  });

  it('says why, in words rather than by shading alone', () => {
    expect(editable([])).toContain('You do not hold this');
  });

  // The rule the file header states — "still ticked, and still removable" — was not what the code
  // did: `unknown` was folded into `disabled`, so the row rendered inert and the key could never be
  // cleaned up. These two assertions are the difference, at the DOM.
  it('renders an unknown key ticked and NOT disabled, so it can be removed', () => {
    const markup = editable(['employee.view', 'retired.view']);
    // select-all + 3 module boxes (hr, fleet, unknown) + 4 permissions + the orphan.
    expect(checkboxes(markup)).toHaveLength(9);
    const orphanBox = checkboxLabelled(markup, 'retired.view');
    expect(orphanBox, 'the orphan checkbox was not rendered').toBeDefined();
    expect(orphanBox).toContain('checked');
    expect(orphanBox).not.toContain('disabled');
  });

  it('still locks the permission the actor does not hold, alongside it', () => {
    const boxes = checkboxes(editable(['employee.view', 'retired.view']));
    expect(boxes.filter((box) => box.includes('disabled'))).toHaveLength(1);
  });

  it('locks every box when the role is managed, bulk controls included', () => {
    const markup = render(
      <RolePermissionMatrix
        catalog={CATALOG}
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
    expect(SOURCE).toMatch(/onBulkChange\(applyBulk\(selected, rows, bulkIntent\([^)]*\), canGrant\)\)/);
    expect(SOURCE).toContain('onToggle?.(row.key, e.target.checked)');
    // `search` appears only in filtering and in the note; never inside a bulk call.
    expect(SOURCE).not.toMatch(/applyBulk\([^)]*search/);
    expect(SOURCE).not.toMatch(/bulkIntent\([^)]*search/);
    expect(SOURCE).not.toMatch(/(applyBulk|bulkIntent)\([^)]*collapsed/);
  });

  it('feeds the bulk controls the module’s full row set, not the filtered one', () => {
    // `rows` is the whole module; `shown` is what the search left. The bulk call takes `rows`.
    expect(SOURCE).toContain('onChange={() => bulk(rows)}');
    expect(SOURCE).toContain('onChange={() => bulk(allRows)}');
    expect(SOURCE).toMatch(/shown\.map\(\(row\)/);
  });
});

describe('the payload shape is untouched', () => {
  it('hands the form a plain string list, not a new structure', () => {
    // `onBulkChange` is typed `(next: string[]) => void`; the form assigns it straight to the
    // `permissionKeys` state that the API has always received.
    expect(SOURCE).toContain('onBulkChange?: ((next: string[]) => void) | undefined;');
    const form = readFileSync(resolve(HERE, 'RoleFormDialog.tsx'), 'utf8');
    expect(form).toContain('const replaceKeys = (next: string[]): void => setKeys(next);');
    expect(form).toContain('permissionKeys: keys');
  });
});
