// The supplier register «الموردون» and its form, proven against what they render (design §13.6 A,
// B, E): the board frame and its header, the columns and what each cell says — the phone MASKED,
// the categories by name — the filters as single choices, the category filter only for a reader
// the categories' read admits, the gates on every write, the empty and the failed list, and the
// form's fields: no code box (the server gives it), no VAT status (OD-29), no bank data, the
// contact people as rows, the tax number's warning beside its box, and the refusals worded.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { supplierListKey, wholeCatalogKey } from '../api/administration-keys';
import { ar, category, headings, pageOf, renderScreen, rowOf, text } from '../screen-fixtures';
import { supplier, supplierDetail } from '../supplier-fixtures';
import { SupplierFormDialog, supplierCategoryOptions } from '../components/SupplierFormDialog';
import { refusalFieldKeys } from '../lib/refusals';
import { SuppliersPage } from './SuppliersPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'SuppliersPage.tsx'), 'utf8');
const FORM = readFileSync(join(HERE, '../components/SupplierFormDialog.tsx'), 'utf8');

const FIRST_PAGE = { page: 1, pageSize: 25, isActive: true };
const NOUR = supplier();
const DELTA = supplier({
  id: 's-2',
  code: 'SUP-00002',
  name: { ar: 'مؤسسة الدلتا للتوريدات', en: 'Delta Supplies' },
  phone: null,
  email: null,
  categories: [],
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
  category({ id: 'c-old', name: { ar: 'الأشرطة', en: 'Ribbons' }, isActive: false }),
];
const CATALOGS = [[wholeCatalogKey('category'), CATEGORIES]] as const;

const render = (
  keys: string[] = ['administrationSupplier.view'],
  path = '/administration/suppliers',
  seed: readonly (readonly [readonly unknown[], unknown])[] = [
    [supplierListKey(FIRST_PAGE), pageOf([NOUR, DELTA])],
  ],
  failing: readonly (readonly unknown[])[] = [],
): string =>
  renderScreen({
    element: <SuppliersPage />,
    route: '/administration/suppliers',
    path,
    keys,
    seed: [...CATALOGS, ...seed],
    failing,
  });

describe('the supplier register', () => {
  it('wears the board frame, its table filling the rest — the frame’s usual floor, not IT’s', () => {
    expect(SOURCE).toContain('<PageContainer fullHeight>');
    expect(SOURCE).toContain('<div className={BOARD_FRAME}>');
    expect(SOURCE).toContain('<div className={BOARD_TABLE_FILL}>');
    expect(SOURCE).not.toContain('BOARD_TABLE_FILL_LOW');
    expect(SOURCE).toContain('stickyHead');
  });

  it('is titled as its sidebar row, under the module’s breadcrumb, with no subtitle', () => {
    const html = render();
    expect(html).toMatch(new RegExp(`<h1[^>]*>${ar('administration.nav.suppliers')}</h1>`, 'u'));
    expect(html).toContain('href="/administration"');
    expect(html).toContain(ar('administration.module.title'));
  });

  it('lists the columns in order, each cell saying what the record says', () => {
    const html = render();
    expect(headings(html)).toEqual([
      ar('administration.suppliers.columns.code'),
      ar('administration.suppliers.columns.name'),
      ar('administration.suppliers.columns.phone'),
      ar('administration.suppliers.columns.email'),
      ar('administration.suppliers.columns.categories'),
      ar('administration.suppliers.columns.status'),
      ar('administration.suppliers.columns.actions'),
    ]);
    const cells = rowOf(html, 'SUP-00001');
    expect(cells[0]).toContain('dir="ltr"');
    expect(cells[0]).toContain('font-mono');
    // The code never breaks at its hyphen on a phone: the table scrolls sideways instead.
    expect(cells[0]).toContain('whitespace-nowrap');
    expect(text(cells[1] ?? '')).toBe('شركة النور للأدوات المكتبية');
    expect(cells[3]).toContain('dir="ltr"');
    expect(text(cells[3] ?? '')).toBe('sales@alnour.example');
    // The categories by the names the record carries, each a chip.
    expect(cells[4]).toContain('>الأحبار<');
    expect(cells[4]).toContain('>الورق<');
    expect(text(cells[5] ?? '')).toBe(ar('administration.status.active'));
    const delta = rowOf(html, 'SUP-00002');
    expect(text(delta[2] ?? '')).toBe('—');
    expect(text(delta[3] ?? '')).toBe('—');
    expect(text(delta[4] ?? '')).toBe('—');
  });

  it('masks the phone — never the whole number in the list (§6.8)', () => {
    const html = render();
    const phone = rowOf(html, 'SUP-00001')[2] ?? '';
    expect(text(phone)).toBe('010****5678');
    expect(phone).toContain('dir="ltr"');
    expect(phone).toContain('whitespace-nowrap');
    // A bidi override, so a number in Arabic-Indic digits keeps its ends where they are typed.
    expect(phone).toContain('<bdo');
    expect(html).not.toContain('01012345678');
    // Nor in a contact's: the register shows no contact's phone at all.
    expect(html).not.toContain('01198765432');
  });

  it('sorts only on what the API sorts — the code and the Arabic name', () => {
    expect(SOURCE).toMatch(
      /key: 'code',\s*header: t\('administration\.suppliers\.columns\.code'\),\s*sortable: true/u,
    );
    expect(SOURCE).toMatch(/sortKey: 'name\.ar'/u);
    expect(SOURCE.match(/sortable: true/gu)).toHaveLength(2);
  });

  it('opens a record from its row, and the row’s own button stops the click', () => {
    expect(SOURCE).toContain(
      'onRowClick={(supplier) => navigate(`/administration/suppliers/${supplier.id}`)}',
    );
    expect(SOURCE).toContain('onClick={(e) => e.stopPropagation()}');
    expect(render()).toContain('cursor-pointer');
  });

  it('offers «add» only to a holder of the create key, and the row edit only to the edit key', () => {
    const label = `aria-label="${ar('administration.suppliers.edit')} — شركة النور للأدوات المكتبية"`;
    const reader = render();
    expect(reader).not.toContain(ar('administration.suppliers.create'));
    expect(reader).not.toContain(label);
    const creator = render(['administrationSupplier.view', 'administrationSupplier.create']);
    expect(creator).toContain(ar('administration.suppliers.create'));
    expect(creator).not.toContain(label);
    const editor = render(['administrationSupplier.view', 'administrationSupplier.edit']);
    expect(editor).toContain(label);
    expect(editor).toContain('data-row-actions="hover"');
  });

  it('says so when nothing matches, and offers a retry when the list failed', () => {
    const empty = render(undefined, undefined, [[supplierListKey(FIRST_PAGE), pageOf([])]]);
    expect(empty).toContain(ar('administration.suppliers.empty'));
    expect(empty).not.toContain(ar('common.pager.perPage'));
    const failed = render(undefined, undefined, [], [supplierListKey(FIRST_PAGE)]);
    expect(failed).toContain(ar('common.error.title'));
    expect(failed).toContain(ar('common.retry'));
  });

  it('filters by one status — the live suppliers by default — and searches the server', () => {
    const html = render();
    expect(html).toContain(`aria-label="${ar('administration.suppliers.columns.status')}"`);
    expect(html).toMatch(/<option value="true" selected="">/u);
    expect(html).toContain(ar('administration.suppliers.searchPlaceholder'));
    expect(SOURCE).not.toContain('MultiSelect');
  });

  it('offers the category filter only to a reader the categories’ read admits', () => {
    // `.view` alone opens no category read (§19.3), so the reader gets no filter it cannot fill.
    const viewer = render();
    expect(viewer).not.toContain(ar('administration.suppliers.allCategories'));
    // Each key the categories' read admits gets both levels — a parent reads its children too.
    for (const extra of [
      'administrationItem.view',
      'administrationCatalog.manage',
      'administrationSupplier.create',
      'administrationSupplier.edit',
    ]) {
      const html = render(['administrationSupplier.view', extra]);
      expect(html, extra).toContain(ar('administration.suppliers.allCategories'));
      expect(html, extra).toContain('>الأحبار — حبر ليزر<');
    }
  });

  it('asks the server for what the URL says — and drops a category the reader cannot filter by', () => {
    const asked = { page: 1, pageSize: 25, search: 'النور', categoryId: 'c-ink', isActive: false };
    const retired = pageOf([supplier({ isActive: false })]);
    const html = render(
      ['administrationSupplier.view', 'administrationItem.view'],
      '/administration/suppliers?q=النور&category=c-ink&active=false',
      [[supplierListKey(asked), retired]],
    );
    expect(text(rowOf(html, 'SUP-00001')[5] ?? '')).toBe(ar('administration.status.inactive'));
    // The same URL for a `.view`-only reader asks for no category it never chose on this screen.
    const viewerAsked = { page: 1, pageSize: 25, search: 'النور', isActive: false };
    const viewer = render(
      undefined,
      '/administration/suppliers?q=النور&category=c-ink&active=false',
      [[supplierListKey(viewerAsked), retired]],
    );
    expect(text(rowOf(viewer, 'SUP-00001')[5] ?? '')).toBe(ar('administration.status.inactive'));
  });
});

describe('the supplier form', () => {
  const dialog = (
    keys: string[],
    subject: Parameters<typeof SupplierFormDialog>[0]['supplier'],
  ): string =>
    renderScreen({
      element: <SupplierFormDialog open onClose={() => undefined} supplier={subject} />,
      route: '/',
      path: '/',
      keys,
      seed: CATALOGS,
    });

  it('asks for no code, no VAT status and no bank data — and files no paper here', () => {
    const html = dialog(['administrationSupplier.create'], null);
    expect(html).toContain(ar('administration.suppliers.create'));
    expect(html).not.toContain(`>${ar('administration.suppliers.columns.code')}<`);
    expect(FORM).not.toMatch(/vatStatus|iban|bankAccount|attachments/u);
    expect(html).not.toContain('type="file"');
  });

  it('writes the Arabic name right to left with no Arabic-only rule, and the numbers left to right', () => {
    const html = dialog(['administrationSupplier.create'], null);
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('data-input-rule="arabic"');
    expect(html).not.toContain('data-input-rule="english"');
    expect(html).toMatch(/dir="ltr"[^>]*data-supplier-tax-number=""/u);
    expect(html).toContain('type="email"');
  });

  it('keeps Save pressable, marks the two required names, and frames itself as the module does', () => {
    const html = dialog(['administrationSupplier.create'], null);
    expect(html).toContain('data-administration-save=""');
    expect(html).not.toMatch(/data-administration-save=""[^>]*disabled/u);
    expect(html.match(/<span class="text-red-500"> \*<\/span>/gu)).toHaveLength(2);
    expect(FORM).toContain('<AdministrationDialogFrame');
    // One explicit column on a phone, so a long categories summary cannot widen the dialog.
    expect(FORM).toContain('grid grid-cols-1 gap-4 sm:grid-cols-2');
    expect(FORM).not.toMatch(/className="grid gap-\d sm:grid-cols-2"/u);
    expect(html).toContain(ar('administration.suppliers.contacts.none'));
  });

  it('lists each contact person as a row, its name required, and offers Active on an edit only', () => {
    expect(dialog(['administrationSupplier.create'], null)).not.toContain(
      ar('administration.suppliers.fields.isActive'),
    );
    const edit = dialog(['administrationSupplier.edit'], NOUR);
    expect(edit).toContain(ar('administration.suppliers.fields.isActive'));
    expect(edit).toContain('شركة النور للأدوات المكتبية — SUP-00001');
    expect(edit.match(/data-supplier-contact="/gu)).toHaveLength(1);
    expect(edit).toContain('value="هشام فؤاد"');
    // The two names and the one contact's name.
    expect(edit.match(/<span class="text-red-500"> \*<\/span>/gu)).toHaveLength(3);
  });

  it('warns beside the tax number when other suppliers hold it — a warning, never a block', () => {
    const shared = supplierDetail({
      taxNumberMatches: [
        {
          id: 's-9',
          code: 'SUP-00009',
          name: { ar: 'فرع النور', en: 'Nour branch' },
          isActive: false,
        },
      ],
    });
    const html = dialog(['administrationSupplier.edit'], shared);
    expect(html).toContain(ar('administration.suppliers.taxNumberShared.title'));
    expect(html).toContain('SUP-00009 — فرع النور');
    expect(html).toContain(ar('administration.status.inactive'));
    // Save stays pressable: nothing about the number holds the save back.
    expect(html).not.toMatch(/data-administration-save=""[^>]*disabled/u);
    expect(dialog(['administrationSupplier.edit'], NOUR)).not.toContain(
      ar('administration.suppliers.taxNumberShared.title'),
    );
    // A save whose answer names other holders says so as it closes.
    expect(FORM).toContain('if (saved.taxNumberMatches.length > 0) {');
    expect(FORM).toContain('toast.warning(');
  });

  it('offers both category levels, the live ones, and keeps a retired one already picked', () => {
    const html = dialog(['administrationSupplier.edit'], NOUR);
    expect(html).toContain(ar('administration.suppliers.fields.categories'));
    const options = supplierCategoryOptions(
      CATEGORIES,
      ['c-old', 'c-ink'],
      [{ id: 'c-old', name: { ar: 'الأشرطة', en: 'Ribbons' } }],
      'ar',
    );
    expect(options.map((option) => option.label)).toEqual([
      'الأشرطة',
      'الأحبار',
      'الأحبار — حبر ليزر',
      'الورق',
    ]);
    // A retired category nobody picked is not offered.
    expect(
      supplierCategoryOptions(CATEGORIES, [], [], 'ar').map((option) => option.value),
    ).not.toContain('c-old');
  });

  it('words a refusal beside the box it names: a taken name, a retired category', () => {
    const named = new Set(
      [
        new ApiError(ErrorCodes.ADMINISTRATION_DUPLICATE, '', 409, [
          { field: 'name', code: 'duplicate', message: '' },
        ]),
        new ApiError(ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE, '', 422, [
          { field: 'categoryIds', code: 'inactive', message: 'c-old' },
        ]),
      ].flatMap((refusal) => Object.keys(refusalFieldKeys(refusal))),
    );
    expect([...named].sort()).toEqual(['categoryIds', 'nameAr']);
    for (const field of ['nameAr', 'categoryIds']) {
      expect(FORM, field).toContain(`error={refusedWord('${field}')}`);
    }
    // The refusal itself, in the frame's alert box, in the reader's words.
    // (After a refusal for a moved version the form is read afresh, and that is said instead.)
    expect(FORM).toMatch(
      /error=\{\s*failure === null\s*\? null\s*: reread\s*\? t\('administration\.suppliers\.errors\.stale'\)\s*: errorMessage\(failure, locale\)\s*\}/u,
    );
    // An e-mail that is no address is marked on Save, before a round trip.
    expect(FORM).toContain('if (hasEmailProblem(form)) return;');
  });

  it('after a refusal for a moved version, shows the supplier as it now is with the reader’s changes kept, and saves with its version', () => {
    // Read afresh and lay the reader's own changes over it, as the module's other dialogs do: a box
    // they did not touch shows the other save, so the next Save never undoes it.
    expect(FORM).toContain(
      'if (base !== null && error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT) {',
    );
    expect(FORM).toContain('await rereadAfterStale(base, form);');
    expect(FORM).toContain('queryFn: () => getSupplier(opened.id),');
    expect(FORM).toContain('staleTime: 0,');
    expect(FORM).toContain('setBase(fresh);');
    expect(FORM).toContain(
      'setForm(carryEdits(supplierFormFrom(opened), typed, supplierFormFrom(fresh)));',
    );
    expect(FORM).toContain("? t('administration.suppliers.errors.stale')");
    // Every save is measured against that base and carries its version.
    expect(FORM).toContain('body: { ...supplierChanges(form, base), version: base.version },');
    expect(FORM).not.toContain('version: supplier.version');
  });

  it('names every category picked in its box, the list as wide as the box', () => {
    expect(FORM).toContain('summaryMax={Math.max(form.categoryIds.length, 1)}');
    expect(FORM).toContain('panelWidth="w-full"');
  });

  it('numbers a contact person in the reader’s digits in the missing-fields list', () => {
    expect(FORM).toContain('n: formatNumber(i + 1, locale),');
  });
});
