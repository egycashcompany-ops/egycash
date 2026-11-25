// The Administrative Affairs home, proven against what it renders (design §13.6 F): a tile per
// screen the reader's grants open, and nothing else; the registers' real counts, each asked only
// under the key its read takes, a failed one saying so and never reading 0; the no-access panel for
// a reader who holds none; and no placeholder anywhere — not the shared `ModuleHome`, whose activity
// card is one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { itemListKey, warehouseListKey } from '../api/administration-keys';
import { ar, item, pageOf, renderScreen, text, warehouse } from '../screen-fixtures';
import { ADMINISTRATION_SHORTCUTS, AdministrationHomePage } from './AdministrationHomePage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'AdministrationHomePage.tsx'), 'utf8');

const COUNT = { page: 1, pageSize: 1, isActive: true };

const render = (
  keys: string[],
  seed: readonly (readonly [readonly unknown[], unknown])[] = [
    [warehouseListKey(COUNT), pageOf([warehouse()], 7)],
    [itemListKey(COUNT), pageOf([item()], 1250)],
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
