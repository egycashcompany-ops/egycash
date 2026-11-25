// One supplier's record and its documents card, proven against what they render (design §13.6 B,
// §11.4–§11.5): the supplier's name as the title, under the module, the register and its code; its
// facts — the phone whole on this page, the registration numbers left to right, the categories by
// name, a dash for what is not set, no VAT status; the tax-number warning, never a block; the edit
// offered to the edit key alone, as the register's own form; the papers with their scan states —
// open, waiting, blocked, gone — filed and removed by a writer only; a plain page that grows down,
// loading through the shared panel, and a record gone shown as the shared error panel.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { supplierKey } from '../api/administration-keys';
import { ar, renderScreen, text } from '../screen-fixtures';
import { paper, supplierDetail } from '../supplier-fixtures';
import { SUPPLIER_PAPER_ACCEPT } from '../components/SupplierDocuments';
import { SupplierDetailPage } from './SupplierDetailPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'SupplierDetailPage.tsx'), 'utf8');
const CARD = readFileSync(join(HERE, '../components/SupplierDocuments.tsx'), 'utf8');
const QUERIES = readFileSync(join(HERE, '../api/suppliers-queries.ts'), 'utf8');

const NOUR = supplierDetail();

const render = (
  keys: string[] = ['administrationSupplier.view'],
  seed: readonly (readonly [readonly unknown[], unknown])[] = [[supplierKey('s-1'), NOUR]],
  failing: readonly (readonly unknown[])[] = [],
): string =>
  renderScreen({
    element: <SupplierDetailPage />,
    route: '/administration/suppliers/:id',
    path: '/administration/suppliers/s-1',
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

/** The documents card's row for one paper, as markup. */
const paperRow = (html: string, attachmentId: string): string => {
  const at = html.indexOf(`data-supplier-paper="${attachmentId}"`);
  expect(at, attachmentId).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</li>', at));
};

describe('the supplier’s record', () => {
  it('is a plain page that grows down, titled with the supplier, under the module, the register and its code', () => {
    expect(SOURCE).toContain('<PageContainer>');
    expect(SOURCE).not.toContain('fullHeight');
    const html = render();
    expect(html).toMatch(/<h1[^>]*>شركة النور للأدوات المكتبية<\/h1>/u);
    expect(html).toContain('href="/administration"');
    expect(html).toContain('href="/administration/suppliers"');
    expect(text(html)).toContain('SUP-00001');
  });

  it('shows the facts — the phone whole here, the numbers left to right, the categories by name', () => {
    const html = render();
    expect(fact(html, ar('administration.suppliers.columns.code'))).toContain('dir="ltr"');
    expect(text(fact(html, ar('administration.suppliers.fields.phone')))).toBe('01012345678');
    expect(fact(html, ar('administration.suppliers.fields.phone'))).toContain('dir="ltr"');
    expect(text(fact(html, ar('administration.suppliers.fields.email')))).toBe(
      'sales@alnour.example',
    );
    expect(text(fact(html, ar('administration.suppliers.fields.taxNumber')))).toBe('123-456-789');
    expect(fact(html, ar('administration.suppliers.fields.taxNumber'))).toContain('dir="ltr"');
    expect(text(fact(html, ar('administration.suppliers.fields.commercialRegistry')))).toBe(
      '98765',
    );
    expect(text(fact(html, ar('administration.suppliers.fields.nameEn')))).toBe(
      'Al Nour Office Supplies',
    );
    const categories = fact(html, ar('administration.suppliers.fields.categories'));
    expect(categories).toContain('>الأحبار<');
    expect(categories).toContain('>الورق<');
    expect(text(fact(html, ar('administration.suppliers.fields.notes')))).toBe('—');
    expect(html).toContain(ar('administration.status.active'));
  });

  it('lists the contact people, each with the phone and e-mail they were given', () => {
    const html = render();
    expect(html).toContain(ar('administration.suppliers.contacts.title'));
    expect(html.match(/data-supplier-contact=""/gu)).toHaveLength(1);
    expect(html).toContain('هشام فؤاد');
    expect(html).toContain('مدير المبيعات');
    expect(html).toContain('01198765432');
    const none = render(undefined, [[supplierKey('s-1'), supplierDetail({ contacts: [] })]]);
    expect(none).toContain(ar('administration.suppliers.contacts.none'));
  });

  it('shows no VAT status — it has no values until OD-29 gives them', () => {
    expect(SOURCE).not.toContain('vatStatus');
  });

  it('warns when other suppliers hold its tax number — each a link, a retired one marked — and blocks nothing', () => {
    expect(render()).not.toContain('data-supplier-tax-warning');
    const shared = supplierDetail({
      taxNumberMatches: [
        {
          id: 's-7',
          code: 'SUP-00007',
          name: { ar: 'فرع النور', en: 'Nour branch' },
          isActive: true,
        },
        {
          id: 's-3',
          code: 'SUP-00003',
          name: { ar: 'النور القديمة', en: 'Old Nour' },
          isActive: false,
        },
      ],
    });
    const html = render(
      ['administrationSupplier.view', 'administrationSupplier.edit'],
      [[supplierKey('s-1'), shared]],
    );
    expect(html).toMatch(/<div role="status" data-supplier-tax-warning=""/u);
    expect(html).toContain(ar('administration.suppliers.taxNumberShared.title'));
    expect(html).toContain('href="/administration/suppliers/s-7"');
    expect(html).toContain('href="/administration/suppliers/s-3"');
    expect(text(html)).toContain(`النور القديمة (${ar('administration.status.inactive')})`);
    // The edit is still offered: a shared number holds nothing back.
    expect(html).toContain(`>${ar('administration.suppliers.edit')}<`);
  });

  it('offers the edit to the edit key alone — the register’s own form, not a route', () => {
    expect(render()).not.toContain(`>${ar('administration.suppliers.edit')}<`);
    expect(render(['administrationSupplier.view', 'administrationSupplier.edit'])).toContain(
      ar('administration.suppliers.edit'),
    );
    expect(SOURCE).not.toMatch(/navigate\(['`]edit/u);
    expect(SOURCE).toContain('onClick={() => setEditing(supplier)}');
    expect(SOURCE).toContain('<SupplierFormDialog');
    expect(SOURCE).toContain('supplier={editing}');
  });

  it('loads through the shared panel, and shows a record it cannot read as the shared error panel', () => {
    expect(SOURCE).toContain('<LoadingState />');
    expect(SOURCE).not.toContain('Skeleton');
    expect(render(undefined, [])).toContain(ar('common.loading'));
    const failed = render(undefined, [], [supplierKey('s-1')]);
    expect(failed).toContain(ar('common.error.title'));
    expect(failed).toContain(ar('common.retry'));
  });
});

describe('the documents card (OD-11 A)', () => {
  it('lists each paper with what it is, its file, its size and its day', () => {
    const html = render();
    expect(html).toContain(ar('administration.suppliers.papers.title'));
    const row = paperRow(html, 'a-1');
    expect(row).toContain('السجل التجاري');
    expect(row).toContain('registry.pdf');
    expect(text(row)).toContain(ar('administration.suppliers.papers.size.kb', { size: '٢٤٠' }));
  });

  it('opens a clean paper, and none that is being scanned, blocked or gone — each saying so', () => {
    const open = `aria-label="${ar('administration.suppliers.papers.open')} — `;
    const html = render(undefined, [
      [
        supplierKey('s-1'),
        supplierDetail({
          attachments: [
            paper(),
            paper({ attachmentId: 'a-2', label: 'البطاقة الضريبية', scanStatus: 'pending' }),
            paper({ attachmentId: 'a-3', label: 'صورة', scanStatus: 'blocked' }),
            paper({ attachmentId: 'a-4', label: 'عقد', scanStatus: null }),
            paper({ attachmentId: 'a-5', label: 'خطاب', scanStatus: 'unscanned' }),
          ],
        }),
      ],
    ]);
    expect(paperRow(html, 'a-1')).toContain(open);
    expect(paperRow(html, 'a-5')).toContain(open);
    expect(paperRow(html, 'a-2')).not.toContain(open);
    expect(paperRow(html, 'a-2')).toContain(ar('administration.suppliers.papers.scan.pending'));
    expect(paperRow(html, 'a-3')).not.toContain(open);
    expect(paperRow(html, 'a-3')).toContain(ar('administration.suppliers.papers.scan.blocked'));
    expect(paperRow(html, 'a-4')).not.toContain(open);
    expect(paperRow(html, 'a-4')).toContain(ar('administration.suppliers.papers.scan.unavailable'));
  });

  it('reads the record again with backoff while a paper is being scanned, and maps a 422 to that', () => {
    expect(QUERIES).toContain('refetchInterval: (query) =>');
    expect(QUERIES).toContain('scanRecheckDelay(query.state.data?.attachments');
    expect(CARD).toContain('error instanceof ApiError && error.status === 422');
    expect(CARD).toContain('if (scan) onScanPending();');
  });

  it('shows the bytes through an object URL — a photo inline, a PDF in a frame — never a files listing', () => {
    expect(CARD).toContain('URL.createObjectURL(blob)');
    expect(CARD).toContain("paper.mime === 'application/pdf'");
    expect(CARD).toContain('<iframe');
    // The bytes come through the module's own paper route, never a `/platform/files` read (§11.4).
    const code = CARD.split('\n').filter((line) => !line.trim().startsWith('//'));
    expect(code.join('\n')).not.toContain('/platform/files');
    expect(CARD).toContain('fetchSupplierPaper(supplierId, attachmentId)');
    expect(SUPPLIER_PAPER_ACCEPT).toBe('application/pdf,image/jpeg,image/png,image/webp');
  });

  it('offers filing and removing to the edit key alone', () => {
    const add = ar('administration.suppliers.papers.add');
    const remove = `aria-label="${ar('administration.suppliers.papers.remove')} — السجل التجاري"`;
    const reader = render();
    expect(reader).not.toContain(`>${add}<`);
    expect(reader).not.toContain(remove);
    const writer = render(['administrationSupplier.view', 'administrationSupplier.edit']);
    expect(writer).toContain(add);
    expect(writer).toContain(remove);
  });

  it('says when none is filed, and stops offering a twenty-first', () => {
    const none = render(undefined, [[supplierKey('s-1'), supplierDetail({ attachments: [] })]]);
    expect(none).toContain(ar('administration.suppliers.papers.empty'));
    const full = render(
      ['administrationSupplier.view', 'administrationSupplier.edit'],
      [
        [
          supplierKey('s-1'),
          supplierDetail({
            attachments: Array.from({ length: 20 }, (_, i) =>
              paper({ attachmentId: `a-${String(i)}`, label: `مستند ${String(i)}` }),
            ),
          }),
        ],
      ],
    );
    expect(full).toContain('data-supplier-papers-full=""');
    expect(full).not.toContain(`>${ar('administration.suppliers.papers.add')}<`);
  });

  it('files a paper with what it is and its version, and removes one with its version', () => {
    expect(CARD).toContain('version: supplier.version,');
    expect(CARD).toContain("key: 'label'");
    expect(CARD).toContain("key: 'file'");
    expect(CARD).toContain('error={failure === null ? null : errorMessage(failure, locale)}');
    expect(CARD).toContain('{errorMessage(failure, locale)}');
  });
});
