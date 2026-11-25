// The Administrative Affairs home, proven against what it renders (design §13.6 F): a tile per
// screen the reader's grants open, and nothing else; the registers' real counts, each asked only
// under the key its read takes, a failed one saying so and never reading 0; the no-access panel for
// a reader who holds none; and no placeholder anywhere — not the shared `ModuleHome`, whose activity
// card is one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { itemListKey, supplierListKey, warehouseListKey } from '../api/administration-keys';
import { useAdministrationItems } from '../api/catalog-queries';
import { useAdministrationWarehouses } from '../api/warehouses-queries';
import { ar, item, pageOf, renderScreen, text, warehouse } from '../screen-fixtures';
import { supplier } from '../supplier-fixtures';
import {
  ADMINISTRATION_SHORTCUTS,
  AdministrationHomePage,
  COUNT_LINKS,
} from './AdministrationHomePage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});
// The two count reads, watched: a server render runs no query, so what the home ASKS for is read
// off the hooks' arguments — the key and whether the read is enabled.
vi.mock('../api/catalog-queries', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/catalog-queries');
  return {
    ...actual,
    useAdministrationItems: vi.fn(actual.useAdministrationItems as (...args: unknown[]) => unknown),
  };
});
vi.mock('../api/warehouses-queries', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/warehouses-queries');
  return {
    ...actual,
    useAdministrationWarehouses: vi.fn(
      actual.useAdministrationWarehouses as (...args: unknown[]) => unknown,
    ),
  };
});
const itemRead = vi.mocked(useAdministrationItems);
const warehouseRead = vi.mocked(useAdministrationWarehouses);

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'AdministrationHomePage.tsx'), 'utf8');

const COUNT = { page: 1, pageSize: 1, isActive: true };

const render = (
  keys: string[],
  seed: readonly (readonly [readonly unknown[], unknown])[] = [
    [warehouseListKey(COUNT), pageOf([warehouse()], 7)],
    [itemListKey(COUNT), pageOf([item()], 1250)],
    [supplierListKey(COUNT), pageOf([supplier()], 42)],
  ],
  failing: readonly (readonly unknown[])[] = [],
): string =>
  renderScreen({
    element: <AdministrationHomePage />,
    route: '/administration',
    path: '/administration',
    keys,
    seed,
    failing,
  });

const ALL = [
  'administrationWarehouse.view',
  'administrationItem.view',
  'administrationCatalog.manage',
  'administrationSupplier.view',
];

describe('the Administrative Affairs home', () => {
  it('is titled as the module, with no breadcrumb and no filter', () => {
    const html = render(ALL);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${ar('administration.home.title')}</h1>`, 'u'));
    expect(html).not.toContain('aria-label="breadcrumb"');
    expect(SOURCE).not.toContain('FilterBar');
  });

  it('draws a tile for each screen the grants open, and none for the others', () => {
    const all = render(ALL);
    for (const card of ADMINISTRATION_SHORTCUTS) {
      expect(all).toContain(`href="${card.to}"`);
      expect(all).toContain(ar(card.descKey));
    }
    const catalogsOnly = render(['administrationCatalog.manage']);
    expect(catalogsOnly).toContain('href="/administration/catalogs"');
    expect(catalogsOnly).not.toContain('href="/administration/items"');
    expect(catalogsOnly).not.toContain('href="/administration/warehouses"');
    // The catalogs' key reads no register, so no count is asked for or drawn.
    expect(catalogsOnly).not.toContain('data-administration-counts');
  });

  it('counts the live rows of each register the reader may read, in the reader’s digits', () => {
    const html = render(ALL);
    expect(text(html)).toContain(ar('administration.home.activeWarehouses'));
    expect(text(html)).toContain('٧');
    expect(text(html)).toContain(ar('administration.home.activeItems'));
    expect(text(html)).toContain('١٬٢٥٠');
    const itemsOnly = render(['administrationItem.view']);
    expect(itemsOnly).toContain(ar('administration.home.activeItems'));
    expect(itemsOnly).not.toContain(ar('administration.home.activeWarehouses'));
    expect(itemsOnly).not.toContain(ar('administration.home.activeSuppliers'));
  });

  it('gives the supplier register its tile and its live count, under its own key (P1b.W)', () => {
    const html = render(['administrationSupplier.view']);
    expect(html).toContain('href="/administration/suppliers"');
    expect(html).toContain(ar('administration.home.cards.suppliers'));
    expect(text(html)).toContain(ar('administration.home.activeSuppliers'));
    expect(text(html)).toContain('٤٢');
    expect(html).not.toContain('href="/administration/items"');
    expect(html).not.toContain(ar('administration.home.activeItems'));
  });

  it('asks each count only under the key its read takes — never a read the server refuses', () => {
    itemRead.mockClear();
    warehouseRead.mockClear();
    render(['administrationItem.view']);
    expect(itemRead).toHaveBeenCalledWith(COUNT, true);
    expect(warehouseRead).toHaveBeenCalledWith(COUNT, false);
    expect(warehouseRead).not.toHaveBeenCalledWith(COUNT, true);
    itemRead.mockClear();
    warehouseRead.mockClear();
    render(['administrationWarehouse.view']);
    expect(warehouseRead).toHaveBeenCalledWith(COUNT, true);
    expect(itemRead).not.toHaveBeenCalledWith(COUNT, true);
  });

  it('opens each count on the view it counts, never on the reader’s remembered filters', () => {
    const html = render(ALL);
    expect(COUNT_LINKS).toEqual({
      warehouses: '/administration/warehouses?active=true',
      items: '/administration/items?active=true',
      suppliers: '/administration/suppliers?active=true',
    });
    expect(html).toContain('href="/administration/warehouses?active=true"');
    expect(html).toContain('href="/administration/items?active=true"');
    expect(html).toContain('href="/administration/suppliers?active=true"');
  });

  it('says a count could not be read rather than showing 0', () => {
    const html = render(
      ALL,
      [[itemListKey(COUNT), pageOf([item()], 3)]],
      [warehouseListKey(COUNT)],
    );
    expect(html).toContain(ar('administration.home.countUnavailable'));
    expect(text(html)).toContain('٣');
  });

  it('tells a reader who holds none of the screens so', () => {
    const html = render(['itAsset.view']);
    expect(html).toContain(ar('administration.home.noAccessTitle'));
    expect(html).toContain(ar('administration.home.noAccessBody'));
    expect(html).not.toContain('href="/administration/');
  });

  it('draws no placeholder — not the shared ModuleHome, whose activity card is one', () => {
    expect(SOURCE).not.toMatch(/import[^;]*\bModuleHome\b/u);
    expect(SOURCE).not.toContain('<ModuleHome');
    expect(SOURCE).not.toContain('RecentActivityCard');
    expect(SOURCE).toContain('<ShortcutCard');
    expect(SOURCE).toContain('<StatCard');
  });
});
