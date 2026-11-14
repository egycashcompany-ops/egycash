// The Operations module home (`/operations`), rendered against the real Arabic catalog and a real
// store: what a person with a given set of grants actually sees there.
//
//   · Round 12's two new screens have their card — «توزيع المحصنات» under the shipments' grant,
//     «تسليم المحصنات» under the vault's, each the grant its route checks;
//   · the two renamed vault screens' cards read their new names — «محصنات الخزينة» and «سجل
//     الخزينة» — and no card says «صرف» or «جرد» any more;
//   · a card is drawn only for a screen its reader may open.
//
// The join to the sidebar (every card is also a sidebar row) is operations-navigation.spec.ts's.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import {
  OPERATIONS_SHORTCUTS,
  OperationsOverviewPage,
  opensShortcut,
} from './OperationsOverviewPage';

const ar = (key: string): string => translate('ar', key);

const me = (permissions: string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const render = (permissions: string[]): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
          auth: { me: me(permissions), status: 'signedIn' as const },
          ui: { theme: 'dark' as const, sidebarOpen: false },
        },
      })}
    >
      <MemoryRouter initialEntries={['/operations']}>
        <OperationsOverviewPage />
      </MemoryRouter>
    </Provider>,
  );

/** The routes the rendered cards link to, in the order drawn. */
const cards = (html: string): string[] =>
  [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1] ?? '');

/** One card's markup — from its link to the next. */
const cardOf = (html: string, to: string): string => {
  const start = html.indexOf(`href="${to}"`);
  expect(start, to).toBeGreaterThan(-1);
  const next = html.indexOf('<a', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

const SHIPMENTS = ['operationsShipment.view'];
const VAULT = ['operationsVault.view'];

describe('Round 12’s two screens have their card, behind their route’s grant', () => {
  it('«توزيع المحصنات» for the shipments’ reader, with its description', () => {
    const html = render(SHIPMENTS);
    const card = cardOf(html, '/operations/secured/distribution');
    expect(card).toContain(ar('operations.nav.securedDistribution'));
    expect(ar('operations.nav.securedDistribution')).toBe('توزيع المحصنات');
    expect(card).toContain(ar('operations.cards.securedDistribution'));
    expect(cards(render(VAULT))).not.toContain('/operations/secured/distribution');
  });

  it('«تسليم المحصنات» for the vault’s reader, with its description', () => {
    const html = render(VAULT);
    const card = cardOf(html, '/operations/vault/handover');
    expect(card).toContain(ar('operations.nav.vaultHandover'));
    expect(ar('operations.nav.vaultHandover')).toBe('تسليم المحصنات');
    expect(card).toContain(ar('operations.cards.vaultHandover'));
    expect(cards(render(SHIPMENTS))).not.toContain('/operations/vault/handover');
  });

  it('gates each on the grant its route checks (routes.tsx)', () => {
    const routes = readFileSync(fileURLToPath(new URL('../routes.tsx', import.meta.url)), 'utf8');
    for (const [to, path] of [
      ['/operations/secured/distribution', 'secured/distribution'],
      ['/operations/vault/handover', 'vault/handover'],
    ] as const) {
      const route = routes.slice(routes.indexOf(`path="${path}"`));
      const guard = /RequirePermission permission="([^"]+)"/.exec(route)?.[1];
      expect(OPERATIONS_SHORTCUTS.find((c) => c.to === to)?.permission, to).toBe(guard);
    }
  });

  it('sits where the sidebar puts it — distribution after the secured screen, handover after receiving', () => {
    const order = cards(render([...SHIPMENTS, ...VAULT]));
    expect(order.indexOf('/operations/secured/distribution')).toBe(
      order.indexOf('/operations/secured') + 1,
    );
    expect(order.indexOf('/operations/vault/handover')).toBe(
      order.indexOf('/operations/vault/receive') + 1,
    );
  });
});

describe('the renamed vault screens read their new names', () => {
  const html = render(VAULT);

  it('«محصنات الخزينة» — was «صرف الخزينة»', () => {
    const card = cardOf(html, '/operations/vault/dispatch');
    expect(card).toContain('محصنات الخزينة');
    expect(card).toContain(ar('operations.cards.vaultDispatch'));
  });

  it('«سجل الخزينة» — was «جرد الخزينة»', () => {
    const card = cardOf(html, '/operations/vault');
    expect(card).toContain('سجل الخزينة');
    expect(card).toContain(ar('operations.cards.vault'));
  });

  it('no card on the module home says «صرف» or «جرد» any more', () => {
    const all = render([...SHIPMENTS, ...VAULT, 'operationsCrew.view', 'operationsCatalog.manage']);
    const text = all.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/صرف|جرد/);
  });
});

describe('a card only for a screen its reader may open', () => {
  it('a vault-only reader sees the vault’s screens and none of the desk’s', () => {
    const routes = cards(render(VAULT));
    expect(routes).toEqual(
      OPERATIONS_SHORTCUTS.filter((c) => opensShortcut(c, (key) => VAULT.includes(key))).map(
        (c) => c.to,
      ),
    );
    expect(routes).not.toContain('/operations/shipments');
  });

  it('a reader with no Operations grant gets the one honest empty state', () => {
    const html = render([]);
    expect(cards(html)).toEqual([]);
    expect(html).toContain(ar('operations.overview.noAccessTitle'));
  });
});

// Round 14 — «خلي المحتوى بتاع تجميع خزينه ده يبقى اسمه تقرير بنوك، وتجميع خزينه كشاشه مفيش حاجه
// اسمها تجميع خزينه، شيلها خالص».
describe('«تجميع الخزينة» is gone, and «تقرير البنوك» is its card for both its readers', () => {
  it('draws no card for the retired address, under any grant', () => {
    const all = render([...SHIPMENTS, ...VAULT, 'operationsCrew.view', 'operationsCatalog.manage']);
    expect(cards(all)).not.toContain('/operations/reports/vault');
    expect(all.replace(/<[^>]+>/g, ' ')).not.toContain('تجميع الخزينة');
    expect(OPERATIONS_SHORTCUTS.map((c) => c.to)).not.toContain('/operations/reports/vault');
  });

  it('draws «تقرير البنوك» for the shipments’ reader and for the vault’s, with the roll-up’s words', () => {
    for (const grants of [SHIPMENTS, VAULT]) {
      const card = cardOf(render(grants), '/operations/reports/banks');
      expect(card).toContain('تقرير البنوك');
      expect(card).toContain(ar('operations.cards.bankReport'));
    }
    // What the card says is the vault roll-up's content, not the completed shipments any more.
    expect(ar('operations.cards.bankReport')).toBe('المحصنات المستلمة في الخزينة خلال الفترة، حسب البنك');
    expect(cards(render(['operationsCrew.view']))).not.toContain('/operations/reports/banks');
  });

  it('gates it on the route guard’s own list (routes.tsx `anyOf`)', () => {
    const routes = readFileSync(fileURLToPath(new URL('../routes.tsx', import.meta.url)), 'utf8');
    const route = routes.slice(routes.indexOf('path="reports/banks"'));
    expect(/<RequirePermission anyOf=\{([A-Z_]+)\}/.exec(route)?.[1]).toBe(
      'OPERATIONS_BANK_REPORT_KEYS',
    );
    expect(OPERATIONS_SHORTCUTS.find((c) => c.to === '/operations/reports/banks')?.permission).toEqual(
      ['operationsShipment.view', 'operationsVault.view'],
    );
  });
});
