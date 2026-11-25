// Units and categories «وحدات القياس والتصنيفات», proven against what they render (design §13.6
// C, E): the two tabs as a hand-written tablist driven by `?kind=`, the units the default; the
// columns, the parent named on the categories' tab; edit as the only row action and «add» only for
// the catalog managers; the empty and the failed list; and the two dialogs — two name boxes with no
// language rule, a whole-number sort order, Active on an edit only, and a parent picked from the
// active top-level categories, never the category itself.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { catalogListKey, wholeCatalogKey } from '../api/administration-keys';
import {
  ar,
  category,
  headings,
  pageOf,
  renderScreen,
  rowOf,
  text,
  unit,
} from '../screen-fixtures';
import { ItemCategoryDialog, parentOptions } from '../components/ItemCategoryDialog';
import { UnitDialog } from '../components/UnitDialog';
import { refusalFieldKeys } from '../lib/refusals';
import { CatalogsPage } from './CatalogsPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'CatalogsPage.tsx'), 'utf8');
const UNIT_FORM = readFileSync(join(HERE, '../components/UnitDialog.tsx'), 'utf8');
const CATEGORY_FORM = readFileSync(join(HERE, '../components/ItemCategoryDialog.tsx'), 'utf8');

const SORTED = { page: 1, pageSize: 25, sortBy: 'sortOrder', sortDir: 'asc' };
const PIECE = unit();
const BOX = unit({
  id: 'u-box',
  code: null,
  name: { ar: 'علبة', en: 'Box' },
  sortOrder: 2,
  isActive: false,
});
const INKS = category();
const LASER = category({
  id: 'c-laser',
  name: { ar: 'حبر ليزر', en: 'Laser toner' },
  parentId: 'c-ink',
  parentName: { ar: 'الأحبار', en: 'Inks' },
});
const OLD = category({ id: 'c-old', name: { ar: 'تصنيف قديم', en: 'Old' }, isActive: false });

const MANAGER = ['administrationCatalog.manage'];

const render = (
  path = '/administration/catalogs',
  seed: readonly (readonly [readonly unknown[], unknown])[] = [
    [catalogListKey({ kind: 'unit', ...SORTED }), pageOf([PIECE, BOX])],
    [catalogListKey({ kind: 'category', ...SORTED }), pageOf([INKS, LASER])],
  ],
  keys: string[] = MANAGER,
  failing: readonly (readonly unknown[])[] = [],
): string =>
  renderScreen({
    element: <CatalogsPage />,
    route: '/administration/catalogs',
    path,
    keys,
    seed,
    failing,
  });

describe('the catalogs screen', () => {
  it('wears the board frame and writes its tablist in the page, the units first', () => {
    expect(SOURCE).toContain('<div className={BOARD_FRAME}>');
    expect(SOURCE).toContain('<div className={BOARD_TABLE_FILL}>');
    expect(SOURCE).not.toContain('BOARD_TABLE_FILL_LOW');
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*data-catalogs-tab="unit"/u);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*data-catalogs-tab="category"/u);
    expect(text(html)).toContain(ar('administration.nav.catalogs'));
  });

  it('lists the units — sort order, both names, the code, the status', () => {
    const html = render();
    expect(headings(html)).toEqual([
      ar('administration.catalogs.fields.sortOrder'),
      ar('administration.catalogs.fields.nameAr'),
      ar('administration.catalogs.fields.nameEn'),
      ar('administration.catalogs.fields.code'),
      ar('common.status'),
      ar('administration.catalogs.columns.actions'),
    ]);
    const box = rowOf(html, 'علبة');
    expect(text(box[0] ?? '')).toBe('٢');
    expect(box[2]).toContain('dir="ltr"');
    expect(text(box[3] ?? '')).toBe('—');
    expect(text(box[4] ?? '')).toBe(ar('administration.status.inactive'));
    expect(text(rowOf(html, 'قطعة')[3] ?? '')).toBe('pcs');
  });

  it('names each category’s parent on the categories’ tab', () => {
    const html = render('/administration/catalogs?kind=category');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*data-catalogs-tab="category"/u);
    expect(headings(html)).toContain(ar('administration.catalogs.fields.parent'));
    const laser = rowOf(html, 'حبر ليزر');
    expect(text(laser[4] ?? '')).toBe('الأحبار');
    expect(text(rowOf(html, '>الأحبار<')[4] ?? '')).toBe('—');
    expect(html).toContain(ar('administration.catalogs.category.add'));
  });

  it('edits only — no delete — and only for a catalog manager', () => {
    const html = render();
    expect(html).toContain(`aria-label="${ar('administration.catalogs.unit.edit')} — قطعة"`);
    expect(html).toContain(ar('administration.catalogs.unit.add'));
    expect(html).not.toContain(`>${ar('common.delete')}<`);
    const reader = render(undefined, undefined, ['administrationItem.view']);
    expect(reader).not.toContain(ar('administration.catalogs.unit.add'));
    expect(reader).not.toContain(`aria-label="${ar('administration.catalogs.unit.edit')} — قطعة"`);
  });

  it('says so when nothing matches, and offers a retry when the list failed', () => {
    const empty = render(undefined, [[catalogListKey({ kind: 'unit', ...SORTED }), pageOf([])]]);
    expect(empty).toContain(ar('administration.catalogs.unit.empty'));
    // The shared panel, padded — and, with no filter set by default, no claim that one hides rows.
    expect(empty).toContain('py-16');
    expect(ar('administration.catalogs.unit.empty')).not.toMatch(/تصفية|فلتر/u);
    expect(ar('administration.catalogs.category.empty')).not.toMatch(/تصفية|فلتر/u);
    const failed = render(undefined, [], MANAGER, [catalogListKey({ kind: 'unit', ...SORTED })]);
    expect(failed).toContain(ar('common.error.title'));
    expect(failed).toContain(ar('common.retry'));
  });

  it('filters by status only — all of them by default', () => {
    const html = render();
    expect(html).toMatch(/<option value="" selected="">[^<]*<\/option>/u);
    expect(html).toContain(ar('administration.status.filterAll'));
  });
});

describe('the unit and category dialogs', () => {
  const show = (element: JSX.Element): string =>
    renderScreen({
      element,
      route: '/',
      path: '/',
      keys: MANAGER,
      seed: [[wholeCatalogKey('category'), [INKS, LASER, OLD]]],
    });

  it('write two name boxes with no language rule, and a whole-number sort order', () => {
    const html = show(<UnitDialog open onClose={() => undefined} unit={null} />);
    expect(html).toContain(ar('administration.catalogs.unit.add'));
    expect(html).toContain('dir="rtl"');
    expect(html).not.toMatch(/data-input-rule="(?:arabic|english)"/u);
    expect(html).toContain('data-input-rule="integer"');
    expect(html).not.toContain('type="number"');
    expect(html.match(/<span class="text-red-500"> \*<\/span>/gu)).toHaveLength(2);
    expect(html).not.toContain(ar('administration.catalogs.fields.isActive'));
  });

  it('rebase on the row as it now is after a stale save, so the next Save is taken', () => {
    for (const file of ['UnitDialog.tsx', 'ItemCategoryDialog.tsx']) {
      const source = readFileSync(join(HERE, '../components', file), 'utf8');
      expect(source, file).toContain('isStaleRefusal(error)');
      expect(source, file).toContain('setRebased(fresh)');
      expect(source, file).toContain('version: base.version');
    }
  });

  it('retire through Active on an edit — never a delete', () => {
    const html = show(<UnitDialog open onClose={() => undefined} unit={PIECE} />);
    expect(html).toContain(ar('administration.catalogs.fields.isActive'));
    expect(html).toContain(ar('administration.catalogs.retireHint'));
    expect(html).not.toContain(`>${ar('common.delete')}<`);
  });

  it('word each refusal beside the box it names — a duplicate name or code, a refused parent', () => {
    const named = (
      code: string,
      details: { field: string; code: string; message: string }[],
    ): string[] => Object.keys(refusalFieldKeys(new ApiError(code, '', 409, details)));
    const duplicates = [
      ...named(ErrorCodes.ADMINISTRATION_DUPLICATE, [
        { field: 'name', code: 'duplicate', message: '' },
      ]),
      ...named(ErrorCodes.ADMINISTRATION_DUPLICATE, [
        { field: 'code', code: 'duplicate', message: '' },
      ]),
    ];
    expect(duplicates).toEqual(['nameAr', 'code']);
    for (const field of duplicates) {
      expect(UNIT_FORM, field).toContain(`error={refusedWord('${field}')}`);
      expect(CATEGORY_FORM, field).toContain(`error={refusedWord('${field}')}`);
    }
    expect(
      named(ErrorCodes.ADMINISTRATION_CATEGORY_PARENT_INVALID, [
        { field: 'parentId', code: 'hasChildren', message: '' },
      ]),
    ).toEqual(['parentId']);
    expect(CATEGORY_FORM).toContain("error={refusedWord('parentId')}");
    for (const form of [UNIT_FORM, CATEGORY_FORM]) {
      expect(form).toContain('error={failure === null ? null : errorMessage(failure, locale)}');
    }
  });

  it('pick a parent from the active top-level categories, never the category itself', () => {
    expect(parentOptions([INKS, LASER, OLD], null, '', 'ar').map((o) => o.value)).toEqual([
      'c-ink',
    ]);
    expect(parentOptions([INKS, LASER, OLD], 'c-ink', '', 'ar')).toEqual([]);
    // The parent a category already names stays, whatever it has become.
    expect(parentOptions([INKS, LASER, OLD], 'c-x', 'c-old', 'ar').map((o) => o.value)).toEqual([
      'c-ink',
      'c-old',
    ]);
    const html = show(<ItemCategoryDialog open onClose={() => undefined} category={LASER} />);
    expect(html).toContain(ar('administration.catalogs.fields.parent'));
    expect(html).toContain('<option value="c-ink" selected="">الأحبار</option>');
    expect(html).toContain(ar('administration.catalogs.category.noParent'));
  });
});
