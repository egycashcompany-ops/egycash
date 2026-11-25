// The quick-selection panel, rendered for real against the locale catalogues and a real
// permission context. As with the matrix (see its spec), the web suite has no jsdom, so nothing
// here clicks: the selection rules are `../lib/action-groups` + `../lib/permission-selection`,
// tested directly. What a render proves is the wiring — labels that exist, a type drawn only where
// it has rows, the third checkbox state announced, and the editor's reach applied.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale, type MeDto, type PermissionDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { PermissionQuickGroups } from './PermissionQuickGroups';

const permission = (key: string, moduleId: string, breakGlass = false): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? 'view',
  moduleId,
  name: { ar: `صلاحية ${key}`, en: `Permission ${key}` },
  breakGlass,
  pageId: null,
});

const CATALOG: PermissionDto[] = [
  permission('employee.view', 'hr'),
  permission('employee.edit', 'hr'),
  permission('employee.viewSensitive', 'hr'),
  permission('employee.purge', 'hr', true),
  permission('fleetVehicle.view', 'fleet'),
  // Out of the editor's reach and not carried: drawn nowhere, counted nowhere.
  permission('contract.approve', 'hr'),
];

const HELD = [
  'employee.view',
  'employee.edit',
  'employee.viewSensitive',
  'employee.purge',
  'fleetVehicle.view',
];

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

const render = (selected: string[], locale: Locale = 'en', permissions = HELD): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <PermissionQuickGroups catalog={CATALOG} selected={selected} onBulkChange={() => undefined} />
    </Provider>,
  );
};

const checkboxLabelled = (markup: string, text: string): string | undefined =>
  markup
    .split('<label')
    .find((chunk) => chunk.slice(0, chunk.indexOf('</label>')).includes(text))
    ?.match(/<input[^>]*type="checkbox"[^>]*\/?>/)?.[0];

describe('the panel asks for labels that exist in both locales', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`no missing key — ${locale}`, () => {
      const markup = render([], locale);
      expect(markup).not.toContain('systemAdmin.roles.quick.');
      expect(markup).not.toContain('systemAdmin.roles.module.');
    });
  }

  it('names the types in Arabic', () => {
    const markup = render([], 'ar');
    expect(markup).toContain('العرض (قراءة فقط)');
    expect(markup).toContain('البيانات الحساسة');
    expect(markup).toContain('الصلاحيات الاستثنائية');
  });
});

describe('a type is drawn only where it has rows, and counts only what the editor is shown', () => {
  it('draws View, Edit, Sensitive and Exceptional, and no type with nothing in it', () => {
    const markup = render([]);
    expect(markup).toContain('View (read only)');
    expect(markup).toContain('>Edit<');
    expect(markup).toContain('Sensitive data');
    expect(markup).toContain('Exceptional permissions');
    expect(markup).not.toContain('>Delete<');
    expect(markup).not.toContain('Import from files');
  });

  it('counts View over both modules and leaves the unreachable approve out entirely', () => {
    const markup = render(['employee.view']);
    // employee.view + fleetVehicle.view
    expect(markup).toContain('1 / 2');
    expect(markup).not.toContain('Approvals and decisions');
  });

  it('offers every module the editor can reach as a scope, after All modules', () => {
    const markup = render([]);
    expect(markup.indexOf('All modules')).toBeLessThan(markup.indexOf('value="hr"'));
    expect(markup).toContain('value="fleet"');
  });
});

describe('the third checkbox state is announced, not merely drawn', () => {
  it('marks View mixed when one of its two rows is ticked', () => {
    expect(checkboxLabelled(render(['employee.view']), 'View (read only)')).toContain(
      'aria-checked="mixed"',
    );
  });

  it('marks View checked when both are ticked, and Edit untouched', () => {
    const markup = render(['employee.view', 'fleetVehicle.view']);
    expect(checkboxLabelled(markup, 'View (read only)')).toMatch(/checked=""/);
    expect(checkboxLabelled(markup, '>Edit<') ?? checkboxLabelled(markup, 'Edit')).not.toMatch(
      /checked=""/,
    );
  });
});
