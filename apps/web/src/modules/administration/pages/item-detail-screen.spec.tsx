// One item's record, proven against what it renders (design §13.6 B): the item's name as the
// title, under the module, the register and the item's code; its facts — the category under its
// parent's name, the unit, the levels in the reader's digits, a dash for what is not set; the edit
// offered to the edit key alone, as the register's own form; a plain page that grows down, loading
// through the shared panel, and a record outside reach or gone shown as the shared error panel.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { itemKey } from '../api/administration-keys';
import { ar, item, renderScreen, text } from '../screen-fixtures';
import { ItemDetailPage } from './ItemDetailPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'ItemDetailPage.tsx'), 'utf8');

const TONER = item();

const render = (
  keys: string[] = ['administrationItem.view'],
  seed: readonly (readonly [readonly unknown[], unknown])[] = [[itemKey('i-1'), TONER]],
  failing: readonly (readonly unknown[])[] = [],
): string =>
  renderScreen({
    element: <ItemDetailPage />,
    route: '/administration/items/:id',
    path: '/administration/items/i-1',
    keys,
    seed,
    failing,
  });

/** The `<dd>` under the `<dt>` that says `label`. */
const fact = (html: string, label: string): string => {
  const at = html.indexOf(`>${label}</dt>`);
  expect(at, label).toBeGreaterThan(-1);
  const dd = /<dd\b[^>]*>([\s\S]*?)<\/dd>/u.exec(html.slice(at));
  return dd?.[0] ?? '';
};

describe('the item’s record', () => {
  it('is a plain page that grows down, titled with the item, under the module, the register and its code', () => {
    expect(SOURCE).toContain('<PageContainer>');
    expect(SOURCE).not.toContain('fullHeight');
    const html = render();
    expect(html).toMatch(/<h1[^>]*>حبر HP 85A<\/h1>/u);
    expect(html).toContain('href="/administration"');
    expect(html).toContain('href="/administration/items"');
    expect(text(html)).toContain('ITM-00001');
  });

  it('shows the item’s facts — the category under its parent, the unit, the levels in Arabic digits', () => {
    const html = render();
    // A code reads left to right inside its row, the row itself in the page's direction: only the
    // value is isolated, so in Arabic it sits under its right-aligned label, not across the cell.
    const code = fact(html, ar('administration.items.columns.code'));
    expect(code).toMatch(/^<dd class="[^"]*font-mono[^"]*">/u);
    expect(code).toContain('<span dir="ltr">ITM-00001</span>');
    expect(text(fact(html, ar('administration.items.fields.category')))).toBe('الأحبار — حبر ليزر');
    expect(text(fact(html, ar('administration.items.fields.unit')))).toBe('قطعة');
    expect(text(fact(html, ar('administration.items.fields.minQty')))).toBe('٢');
    expect(text(fact(html, ar('administration.items.fields.reorderPointQty')))).toBe('٥');
    expect(text(fact(html, ar('administration.items.fields.maxQty')))).toBe('٢٠');
    expect(text(fact(html, ar('administration.items.fields.nameEn')))).toBe('HP 85A toner');
    expect(fact(html, ar('administration.items.fields.nameEn'))).toMatch(
      /^<dd class="[^"]*"><span dir="ltr">HP 85A toner<\/span><\/dd>$/u,
    );
    // The Arabic name keeps its order in the English screen too («حبر HP 85A»).
    expect(fact(html, ar('administration.items.fields.nameAr'))).toContain(
      '<span dir="rtl">حبر HP 85A</span>',
    );
    expect(fact(html, ar('administration.items.fields.barcode'))).not.toMatch(/^<dd[^>]*dir=/u);
    expect(text(fact(html, ar('administration.items.fields.description')))).toBe('—');
    expect(html).toContain(ar('administration.status.active'));
  });

  it('says «—» for a level not set, and a retired item says so', () => {
    const html = render(undefined, [
      [itemKey('i-1'), item({ minQty: null, maxQty: null, isActive: false })],
    ]);
    expect(text(fact(html, ar('administration.items.fields.minQty')))).toBe('—');
    expect(text(fact(html, ar('administration.items.fields.maxQty')))).toBe('—');
    expect(html).toContain(ar('administration.status.inactive'));
  });

  it('offers the edit to the edit key alone — the register’s own form, not a route', () => {
    expect(render()).not.toContain(`>${ar('administration.items.edit')}<`);
    expect(render(['administrationItem.view', 'administrationItem.edit'])).toContain(
      ar('administration.items.edit'),
    );
    expect(SOURCE).not.toMatch(/navigate\(['`]edit/u);
    // The form edits the item as it was when it opened, as the register's does: a re-read of the
    // record underneath never resets the typing; a stale save rebases the form itself.
    expect(SOURCE).toContain('onClick={() => setEditing(item)}');
    expect(SOURCE).toContain('<ItemFormDialog open={editing !== null}');
    expect(SOURCE).toContain('item={editing}');
  });

  it('loads through the shared panel, and shows a record it cannot read as the shared error panel', () => {
    expect(SOURCE).toContain('<LoadingState />');
    expect(SOURCE).not.toContain('Skeleton');
    expect(render(undefined, [])).toContain(ar('common.loading'));
    const failed = render(undefined, [], [itemKey('i-1')]);
    expect(failed).toContain(ar('common.error.title'));
    expect(failed).toContain(ar('common.retry'));
  });

  it('asks nothing else: the references arrive named on the item', () => {
    expect(SOURCE).not.toMatch(/useWhole(?:Units|Categories)|useAdministrationCategories/u);
  });
});
