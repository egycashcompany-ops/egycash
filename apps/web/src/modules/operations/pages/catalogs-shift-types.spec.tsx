// «أنواع التشغيل» on the reference-data screen (Round 20) — «انا عاوز النوع يكون بيضاف من البيانات
// المرجعيه». Rendered against the real Arabic catalog, a real store and query client, as the
// currencies' tab is (catalogs-currency-order.spec.tsx): the whole list in the catalog's order, each
// type drawn as the board draws it; for a manager a grip, draggable rows, the arrows, and archive /
// restore in one click; the form's palette is the contract's, every swatch named.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_SHIFT_TYPE_COLOURS,
  type Locale,
  type MeDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { SHIFT_TYPE_LIST } from '../lib/crew-plan';
import { ShiftTypeDialog, freeShiftTypeColour } from '../components/CatalogDialogs';
import { CatalogsPage } from './CatalogsPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

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

const shiftType = (
  id: string,
  name: string,
  colour: OperationsShiftTypeDto['colour'],
  sortOrder: number | null,
  isActive = true,
): OperationsShiftTypeDto => ({
  id,
  name,
  nameEn: null,
  colour,
  sortOrder,
  isActive,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// As the server answers: in the catalog's order, «أسوان» archived, «مسائي» never placed.
const SERVER_ORDER = [
  shiftType('daily', 'يومي', 'rose', 0),
  shiftType('reserve', 'احتياطي', 'teal', 1),
  shiftType('aswan', 'أسوان', 'indigo', 2, false),
  shiftType('evening', 'مسائي', 'violet', null),
];

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (permissions: string[]): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('operations', 'shiftTypes', SHIFT_TYPE_LIST), {
    items: SERVER_ORDER,
    meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: SERVER_ORDER.length, totalPages: 1 },
  });
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/catalogs?kind=shiftTypes']}>
          <Routes>
            <Route path="/operations/catalogs" element={<CatalogsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The `<tr>` of a type, by its action box. */
const rowOf = (html: string, id: string): string => {
  const at = html.indexOf(`data-shift-type-actions="${id}"`);
  expect(at, `the ${id} row`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};

describe('the «أنواع التشغيل» tab — the crew board’s «النوع» as reference data', () => {
  const html = render(['operationsCatalog.manage']);

  it('is a tab of its own, with its own «add»', () => {
    expect(html).toContain(`>${ar('operations.catalogs.tab.shiftTypes')}<`);
    expect(html).toContain(ar('operations.catalogs.shiftType.add'));
  });

  it('lists the WHOLE catalog in the order the server answered — archived types too', () => {
    const at = SERVER_ORDER.map((type) => html.indexOf(`data-shift-type-actions="${type.id}"`));
    expect(at.every((index) => index > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // One page: a list cannot be dragged into order across pages.
    expect(html).not.toContain(ar('common.pagination.perPage'));
  });

  it('draws every type as the board does — its name in its colour', () => {
    for (const type of SERVER_ORDER) {
      const row = rowOf(html, type.id);
      expect(row).toContain(`>${type.name}<`);
      expect(row).toContain(`bg-${type.colour}-500`);
      expect(row).toContain(ar(`operations.catalogs.shiftType.colours.${type.colour}`));
    }
  });

  it('gives a manager the grip, the drag, the arrows — and archive or restore by the row’s state', () => {
    for (const { id } of SERVER_ORDER) {
      expect(html).toContain(`data-drag-handle="${id}"`);
      expect(rowOf(html, id)).toMatch(/^<tr[^>]*draggable="true"/);
    }
    expect(html).toContain(ar('operations.catalogs.shiftType.orderHint'));
    const up = `aria-label="${ar('operations.catalogs.shiftType.moveUp')}"`;
    const down = `aria-label="${ar('operations.catalogs.shiftType.moveDown')}"`;
    expect(rowOf(html, 'daily')).toMatch(new RegExp(`${up}[^>]*disabled=""`));
    expect(rowOf(html, 'evening')).toMatch(new RegExp(`${down}[^>]*disabled=""`));
    expect(rowOf(html, 'daily')).toContain('data-shift-type-toggle="archive"');
    expect(rowOf(html, 'daily')).toContain(
      `aria-label="${ar('operations.catalogs.shiftType.archive')}"`,
    );
    // An archived type is restored, never deleted — and reads dimmed, «غير نشط».
    const aswan = rowOf(html, 'aswan');
    expect(aswan).toContain('data-shift-type-toggle="restore"');
    expect(aswan).toContain(`aria-label="${ar('operations.catalogs.shiftType.restore')}"`);
    expect(aswan).toMatch(/^<tr[^>]*opacity-60/);
    expect(aswan).toContain(ar('operations.common.inactive'));
    // The pen stays first in the box.
    const daily = rowOf(html, 'daily');
    expect(daily.indexOf(`aria-label="${ar('common.edit')}"`)).toBeLessThan(
      daily.indexOf('data-shift-type-toggle'),
    );
  });
});

describe('the «أنواع التشغيل» tab without the catalog grant', () => {
  const html = render([]);

  it('lists the same types, with no grip, no drag, no arrows and no archive', () => {
    expect(html).toContain('data-shift-type-actions="daily"');
    expect(html).not.toContain('data-drag-handle');
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('data-shift-type-toggle');
    expect(html).not.toContain(ar('operations.catalogs.shiftType.orderHint'));
  });
});

describe('the type’s form — the board’s palette (Round 24b), each colour named', () => {
  const formHtml = (shiftType: OperationsShiftTypeDto | null): string =>
    renderToStaticMarkup(
      <Provider store={store(['operationsCatalog.manage'])}>
        <QueryClientProvider client={new QueryClient()}>
          <ShiftTypeDialog
            open
            shiftType={shiftType}
            types={SERVER_ORDER}
            onClose={() => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );
  const swatchesOf = (html: string): (string | undefined)[] =>
    [...html.matchAll(/role="radio" data-colour="([a-z]+)"/g)].map((m) => m[1]);
  const html = formHtml(null);

  it('offers a NEW type the palette for the live types and itself — each a named swatch — and draws the type as it will read', () => {
    // Three live types (one archived): a new one makes four — «يكون نفس عدد النوع»: the three colours
    // worn (rose, violet, teal) and the first nobody wears (emerald), in the palette's order.
    const swatches = swatchesOf(html);
    expect(swatches).toEqual(['rose', 'emerald', 'violet', 'teal']);
    for (const colour of ['rose', 'emerald', 'violet', 'teal']) {
      expect(html).toContain(
        `aria-label="${ar(`operations.catalogs.shiftType.colours.${colour}`)}"`,
      );
    }
    expect(html).toContain('data-shift-type-preview="true"');
    expect(html).toContain(ar('operations.catalogs.shiftType.name'));
    expect(html).toContain(ar('operations.catalogs.shiftType.nameEn'));
  });

  it('offers an EDITED type the live types’ palette — its own colour always among it while live', () => {
    // «احتياطي» wears teal — the SIXTH colour: worn, so among the three shown, never pushed off.
    expect(swatchesOf(formHtml(SERVER_ORDER[1] as OperationsShiftTypeDto))).toEqual([
      'rose',
      'violet',
      'teal',
    ]);
    // «يومي» wears rose, among them: the same three.
    expect(swatchesOf(formHtml(SERVER_ORDER[0] as OperationsShiftTypeDto))).toEqual([
      'rose',
      'violet',
      'teal',
    ]);
    // «أسوان», archived, wears indigo — nobody live does: kept, at the end.
    expect(swatchesOf(formHtml(SERVER_ORDER[2] as OperationsShiftTypeDto))).toEqual([
      'rose',
      'violet',
      'teal',
      'indigo',
    ]);
  });

  it('starts a new type on the first shown colour no ACTIVE type wears — an archived one’s is free', () => {
    // rose, teal and violet are worn; indigo is worn by «أسوان», archived. Shown: rose, emerald,
    // violet, teal.
    expect(freeShiftTypeColour(SERVER_ORDER)).toBe('emerald');
    expect(
      freeShiftTypeColour(OPERATIONS_SHIFT_TYPE_COLOURS.map((c, i) => shiftType(c, c, c, i))),
    ).toBe('rose');
  });
});
