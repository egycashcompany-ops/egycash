// The item register «الأصناف» and its form, proven against what they render (design §13.6 A, E):
// the board frame and its header, the columns and what each cell says, the filters as single
// choices over the cached catalogs, the gates on every write, the empty and the failed list, and
// the form's fields — no code box (the server gives it), no stock box (ADR-024), an Arabic name
// with no Arabic-only rule («حبر HP 85A»), whole-number levels, and Active on an edit only.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { itemListKey, wholeCatalogKey } from '../api/administration-keys';
import {
  ar,
  category,
  headings,
  item,
  pageOf,
  renderScreen,
  rowOf,
  text,
  unit,
} from '../screen-fixtures';
import { AdministrationDialogFrame } from '../components/AdministrationDialogFrame';
import { ItemFormDialog } from '../components/ItemFormDialog';
import { refusalFieldKeys } from '../lib/refusals';
import { ItemsPage } from './ItemsPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'ItemsPage.tsx'), 'utf8');
const FORM = readFileSync(join(HERE, '../components/ItemFormDialog.tsx'), 'utf8');

const FIRST_PAGE = { page: 1, pageSize: 25, isActive: true };
const TONER = item();
const PAPER = item({
  id: 'i-2',
  code: 'ITM-00002',
  barcode: null,
  name: { ar: 'ورق تصوير A4', en: 'A4 copy paper' },
  categoryId: 'c-paper',
  categoryName: { ar: 'الورق', en: 'Paper' },
  categoryParentId: null,
  categoryParentName: null,
});
const CATEGORIES = [
  category(),
  category({
    id: 'c-laser',
    name: { ar: 'حبر ليزر', en: 'Laser toner' },
    parentId: 'c-ink',
    parentName: { ar: 'الأحبار', en: 'Inks' },
  }),
  category({ id: 'c-paper', name: { ar: 'الورق', en: 'Paper' } }),
];
const UNITS = [unit(), unit({ id: 'u-box', code: 'box', name: { ar: 'علبة', en: 'Box' } })];
const CATALOGS = [
  [wholeCatalogKey('category'), CATEGORIES],
  [wholeCatalogKey('unit'), UNITS],
] as const;

const render = (
  keys: string[] = ['administrationItem.view'],
  path = '/administration/items',
  seed: readonly (readonly [readonly unknown[], unknown])[] = [
    [itemListKey(FIRST_PAGE), pageOf([TONER, PAPER])],
  ],
  failing: readonly (readonly unknown[])[] = [],
): string =>
  renderScreen({
    element: <ItemsPage />,
    route: '/administration/items',
    path,
    keys,
    seed: [...CATALOGS, ...seed],
    failing,
  });

describe('the item register', () => {
  it('wears the board frame, its table filling the rest — the frame’s usual floor, not IT’s', () => {
    expect(SOURCE).toContain('<PageContainer fullHeight>');
    expect(SOURCE).toContain('<div className={BOARD_FRAME}>');
    expect(SOURCE).toContain('<div className={BOARD_TABLE_FILL}>');
    expect(SOURCE).not.toContain('BOARD_TABLE_FILL_LOW');
    expect(SOURCE).toContain('stickyHead');
  });

  it('is titled as its sidebar row, under the module’s breadcrumb, with no subtitle', () => {
    const html = render();
    expect(html).toContain(`<h1`);
    expect(text(html)).toContain(ar('administration.nav.items'));
    expect(html).toContain('href="/administration"');
    expect(html).toContain(ar('administration.module.title'));
  });

  it('lists the columns in order, each cell saying what the record says', () => {
    const html = render();
    expect(headings(html)).toEqual([
      ar('administration.items.columns.code'),
      ar('administration.items.columns.name'),
      ar('administration.items.columns.barcode'),
      ar('administration.items.columns.category'),
      ar('administration.items.columns.unit'),
      ar('common.status'),
      ar('administration.items.columns.actions'),
    ]);
    const cells = rowOf(html, 'ITM-00001');
    expect(cells[0]).toContain('dir="ltr"');
    expect(cells[0]).toContain('font-mono');
    expect(text(cells[1] ?? '')).toBe('حبر HP 85A');
    expect(text(cells[2] ?? '')).toBe('6221234567890');
    // A subcategory under its parent's name.
    expect(text(cells[3] ?? '')).toBe('الأحبار — حبر ليزر');
    expect(text(cells[4] ?? '')).toBe('قطعة');
    expect(text(cells[5] ?? '')).toBe(ar('administration.status.active'));
    // No barcode is a dash; a top-level category is its own name.
    const paper = rowOf(html, 'ITM-00002');
    expect(text(paper[2] ?? '')).toBe('—');
    expect(text(paper[3] ?? '')).toBe('الورق');
  });

  it('sorts only on what the API sorts — the code and the Arabic name', () => {
    expect(SOURCE).toMatch(
      /key: 'code',\s*header: t\('administration\.items\.columns\.code'\),\s*sortable: true/u,
    );
    expect(SOURCE).toMatch(/sortKey: 'name\.ar'/u);
    expect(SOURCE.match(/sortable: true/gu)).toHaveLength(2);
  });

  it('opens a record from its row, and the row’s own button stops the click', () => {
    expect(SOURCE).toContain('onRowClick={(item) => navigate(`/administration/items/${item.id}`)}');
    expect(SOURCE).toContain('onClick={(e) => e.stopPropagation()}');
    expect(render()).toContain('cursor-pointer');
  });

  it('offers «add» only to a holder of the create key, and the row edit only to the edit key', () => {
    const reader = render();
    expect(reader).not.toContain(ar('administration.items.create'));
    expect(reader).not.toContain(`aria-label="${ar('administration.items.edit')} — حبر HP 85A"`);
    const creator = render(['administrationItem.view', 'administrationItem.create']);
    expect(creator).toContain(ar('administration.items.create'));
    expect(creator).not.toContain(`aria-label="${ar('administration.items.edit')} — حبر HP 85A"`);
    const editor = render(['administrationItem.view', 'administrationItem.edit']);
    expect(editor).toContain(`aria-label="${ar('administration.items.edit')} — حبر HP 85A"`);
    expect(editor).toContain('data-row-actions="hover"');
  });

  it('says so when nothing matches, and offers a retry when the list failed', () => {
    const empty = render(undefined, undefined, [[itemListKey(FIRST_PAGE), pageOf([])]]);
    expect(empty).toContain(ar('administration.items.empty'));
    // No pager under an empty list.
    expect(empty).not.toContain(ar('common.pager.perPage'));
    const failed = render(undefined, undefined, [], [itemListKey(FIRST_PAGE)]);
    expect(failed).toContain(ar('common.error.title'));
    expect(failed).toContain(ar('common.retry'));
  });

  it('filters by one category, one unit and one status — the live items by default', () => {
    const html = render();
    expect(html).toContain(`aria-label="${ar('common.status')}"`);
    expect(html).toMatch(/<option value="true" selected="">/u);
    // Both levels, a subcategory under its parent's name — a top-level category reads its
    // subcategories' items too.
    expect(html).toContain('>الأحبار<');
    expect(html).toContain('>الأحبار — حبر ليزر<');
    expect(html).toContain(ar('administration.items.allCategories'));
    expect(html).toContain(ar('administration.items.allUnits'));
    expect(SOURCE).not.toContain('MultiSelect');
  });

  it('asks the server for what the URL says', () => {
    const asked = { page: 1, pageSize: 25, search: 'حبر', categoryId: 'c-ink', isActive: false };
    const html = render(undefined, '/administration/items?q=حبر&category=c-ink&active=false', [
      [itemListKey(asked), pageOf([item({ isActive: false })])],
    ]);
    expect(text(rowOf(html, 'ITM-00001')[5] ?? '')).toBe(ar('administration.status.inactive'));
  });
});

describe('the item form', () => {
  const dialog = (keys: string[], subject: Parameters<typeof ItemFormDialog>[0]['item']): string =>
    renderScreen({
      element: <ItemFormDialog open onClose={() => undefined} item={subject} />,
      route: '/',
      path: '/',
      keys,
      seed: CATALOGS,
    });

  it('asks for no code and no stock — the server gives the code, a document moves stock', () => {
    const html = dialog(['administrationItem.create'], null);
    expect(html).toContain(ar('administration.items.create'));
    expect(html).not.toContain(`>${ar('administration.items.columns.code')}<`);
    expect(html).toContain(ar('administration.items.fields.barcodeHint'));
    expect(html).not.toMatch(/onHand|openingQty/u);
  });

  it('takes a Latin brand in the Arabic name — no Arabic-only rule — and whole-number levels', () => {
    const html = dialog(['administrationItem.create'], null);
    expect(html).not.toContain('data-input-rule="arabic"');
    expect(html).not.toContain('data-input-rule="english"');
    expect(html).toContain('dir="rtl"');
    expect(html.match(/data-input-rule="integer"/gu)).toHaveLength(3);
    expect(html).not.toContain('type="number"');
  });

  it('keeps Save pressable, marks the four required boxes, and frames itself as the module does', () => {
    const html = dialog(['administrationItem.create'], null);
    expect(html).toContain('data-administration-save=""');
    expect(html).not.toMatch(/data-administration-save=""[^>]*disabled/u);
    expect(html.match(/<span class="text-red-500"> \*<\/span>/gu)).toHaveLength(4);
  });

  it('offers Active on an edit only, and names the record it edits', () => {
    expect(dialog(['administrationItem.create'], null)).not.toContain(
      ar('administration.items.fields.isActive'),
    );
    const edit = dialog(['administrationItem.edit'], TONER);
    expect(edit).toContain(ar('administration.items.fields.isActive'));
    expect(edit).toContain('حبر HP 85A — ITM-00001');
    expect(edit).toContain('value="5"');
  });

  it('says a refusal in the reader’s words above the fields, and beside the box it names', () => {
    // The frame's alert box: the shared table's sentence, in Arabic — never the server's English.
    const Framed = ({ error }: { error: string | null }): JSX.Element => {
      const required = useRequiredFields([], true);
      return (
        <AdministrationDialogFrame
          open
          onClose={() => undefined}
          title="—"
          required={required}
          onSave={() => undefined}
          busy={false}
          error={error}
        >
          <p />
        </AdministrationDialogFrame>
      );
    };
    const frame = (error: string | null): string =>
      renderScreen({ element: <Framed error={error} />, route: '/', path: '/', keys: [] });
    const duplicate = new ApiError(ErrorCodes.ADMINISTRATION_DUPLICATE, 'name taken', 409, [
      { field: 'name', code: 'duplicate', message: '' },
    ]);
    const shown = frame(errorMessage(duplicate, 'ar'));
    expect(shown).toMatch(/<p role="alert" data-administration-refusal=""/u);
    expect(shown).toContain(errorMessage(duplicate, 'ar'));
    expect(shown).not.toContain('name taken');
    expect(frame(null)).not.toContain('data-administration-refusal');
    expect(FORM).toContain('error={failure === null ? null : errorMessage(failure, locale)}');
    // Every box an item's refusal can name is a box the form words it on.
    const refusals = [
      duplicate,
      new ApiError(ErrorCodes.ADMINISTRATION_DUPLICATE, '', 409, [
        { field: 'barcode', code: 'duplicate', message: '' },
      ]),
      new ApiError(ErrorCodes.ADMINISTRATION_STOCK_LEVELS_ORDER, '', 422, [
        { field: 'minQty', code: 'outOfOrder', message: '' },
        { field: 'reorderPointQty', code: 'outOfOrder', message: '' },
        { field: 'maxQty', code: 'outOfOrder', message: '' },
      ]),
      new ApiError(ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE, '', 422, [
        { field: 'unitId', code: 'inactive', message: '' },
        { field: 'categoryId', code: 'inactive', message: '' },
      ]),
      new ApiError(ErrorCodes.ADMINISTRATION_SUBCATEGORY_REQUIRED, '', 422, [
        { field: 'categoryId', code: 'subcategoryRequired', message: '' },
      ]),
    ];
    const named = new Set(refusals.flatMap((refusal) => Object.keys(refusalFieldKeys(refusal))));
    expect([...named].sort()).toEqual(
      ['barcode', 'categoryId', 'maxQty', 'minQty', 'nameAr', 'reorderPointQty', 'unitId'].sort(),
    );
    for (const field of ['nameAr', 'categoryId', 'unitId']) {
      expect(FORM, field).toContain(`error={refusedWord('${field}')}`);
    }
    // The barcode: the form's own check first (a space inside), then the server's word.
    expect(FORM).toContain(
      "barcodeWrong ? t('administration.items.errors.barcodeSpaces') : refusedWord('barcode')",
    );
    // The three levels: the form's own checks first, then the server's word for the box.
    expect(FORM).toContain('error={levelWord(field)}');
    expect(FORM).toContain('return fieldRefusal(refused, field, t);');
  });

  it('marks a barcode with a space, and levels out of order, on the press that names what is missing', () => {
    // The contract's refusal of a spaced barcode is a plain 400 naming no box, so the form says it.
    expect(FORM).toContain('const pressed = tried || required.attempt > 0;');
    expect(FORM).toContain("problem === 'outOfOrder' && pressed");
    expect(FORM).toContain("barcodeWrong ? t('administration.items.errors.barcodeSpaces')");
    expect(FORM).toContain('!barcodeOk(form.barcode)) return;');
  });

  it('rebases on the item as it now is after a stale save, so the next Save is taken', () => {
    expect(FORM).toContain('isStaleRefusal(error)');
    expect(FORM).toContain('setRebased(fresh)');
    // …keeping the reader's own changes over the record as it now is.
    expect(FORM).toContain('setForm(carryEdits(itemFormFrom(base), form, itemFormFrom(fresh)))');
    expect(FORM).toContain('version: base.version');
  });

  it('files an item under a subcategory where its category has one', () => {
    const html = dialog(['administrationItem.create'], null);
    expect(html).toContain('>الأحبار — حبر ليزر<');
    expect(html).not.toMatch(/<option value="c-ink">/u);
    expect(html).toMatch(/<option value="c-paper">الورق<\/option>/u);
  });
});
