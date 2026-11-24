// The supplier contracts, pinned (design §2.3.6, §11.2, §19.4, §19.7): every write schema is strict,
// so a client-sent `code` or `nameKey`, a bank field, a stock figure or a paper smuggled into the
// body is refused instead of dropped; a supplier lists at most 20 contacts (a 21st is refused); the
// VAT status takes no value until OD-29 gives the values; an update carries its version, and so do
// a paper's link and removal; and the papers' category takes PDF and images only (OD-76 (i)).
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY,
  ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB,
  ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES,
  ADMINISTRATION_SUPPLIER_MAX_CATEGORIES,
  ADMINISTRATION_SUPPLIER_MAX_CONTACTS,
  ADMINISTRATION_SUPPLIER_REFERENCE_FIELDS,
  ADMINISTRATION_SUPPLIER_TAX_NUMBER_MATCHES,
  ADMINISTRATION_SUPPLIER_VAT_STATUSES,
  AddAdministrationSupplierAttachmentSchema,
  AdministrationSupplierAttachmentVersionQuerySchema,
  CreateAdministrationSupplierSchema,
  ListAdministrationSuppliersQuerySchema,
  UpdateAdministrationSupplierSchema,
} from './administration-procurement.js';

const oid = (n: number): string => n.toString(16).padStart(24, '0');
const name = { ar: 'مؤسسة النور للتوريدات', en: 'Al Nour Supplies' };
const contact = (n: number) => ({ name: `Contact ${String(n)}` });

describe('a supplier’s create', () => {
  it('takes a name alone, its lists defaulting empty', () => {
    expect(CreateAdministrationSupplierSchema.parse({ name })).toEqual({
      name,
      contacts: [],
      categoryIds: [],
    });
  });

  it('takes the OD-11 A fields, trimmed', () => {
    const parsed = CreateAdministrationSupplierSchema.parse({
      name,
      phone: ' 0225551234 ',
      email: 'sales@alnour.example',
      address: 'القاهرة',
      contacts: [{ name: ' أحمد ', role: 'مبيعات', phone: '0100', email: 'a@alnour.example' }],
      categoryIds: [oid(1), oid(2)],
      taxNumber: ' 123-456-789 ',
      commercialRegistry: '98765',
      vatStatus: null,
      paymentTerms: 'نقدًا عند الاستلام',
      notes: 'مورد الأدوات المكتبية',
    });
    expect(parsed.phone).toBe('0225551234');
    expect(parsed.taxNumber).toBe('123-456-789');
    expect(parsed.contacts).toEqual([
      { name: 'أحمد', role: 'مبيعات', phone: '0100', email: 'a@alnour.example' },
    ]);
  });

  it.each([
    ['code', { code: 'SUP-00001' }],
    ['nameKey', { nameKey: 'مؤسسهالنورللتوريدات' }],
    ['isActive', { isActive: false }],
    ['attachments', { attachments: [] }],
    ['a bank account', { bankAccount: '1234' }],
    ['an IBAN', { iban: 'EG380019000500000000263180002' }],
    ['a national id', { nationalId: '29801011234567' }],
    ['an on-hand figure', { onHandQty: 3 }],
  ])('refuses %s — the server owns it, or OD-11 A keeps no such field', (_label, extra) => {
    expect(CreateAdministrationSupplierSchema.safeParse({ name, ...extra }).success).toBe(false);
  });

  it(`lists at most ${String(ADMINISTRATION_SUPPLIER_MAX_CONTACTS)} contacts — a 21st is refused`, () => {
    expect(ADMINISTRATION_SUPPLIER_MAX_CONTACTS).toBe(20);
    const twenty = Array.from({ length: 20 }, (_, i) => contact(i));
    expect(CreateAdministrationSupplierSchema.safeParse({ name, contacts: twenty }).success).toBe(
      true,
    );
    expect(
      CreateAdministrationSupplierSchema.safeParse({ name, contacts: [...twenty, contact(20)] })
        .success,
    ).toBe(false);
    expect(
      UpdateAdministrationSupplierSchema.safeParse({
        contacts: [...twenty, contact(20)],
        version: 0,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['a contact without a name', { contacts: [{ phone: '0100' }] }],
    ['a contact with a stray key', { contacts: [{ name: 'x', bankAccount: '1' }] }],
    ['an email that is not one', { email: 'sales at alnour' }],
    ['a blank tax number', { taxNumber: '  ' }],
    ['a tax number past 50 characters', { taxNumber: '1'.repeat(51) }],
    ['a category that is not an id', { categoryIds: ['stationery'] }],
    ['no Arabic name', { name: { en: 'Al Nour' } }],
  ])('refuses %s', (_label, body) => {
    expect(CreateAdministrationSupplierSchema.safeParse({ name, ...body }).success).toBe(false);
  });

  it('bounds the categories a row names, as every stored list is bounded', () => {
    const ids = Array.from({ length: ADMINISTRATION_SUPPLIER_MAX_CATEGORIES + 1 }, (_, i) =>
      oid(i),
    );
    expect(CreateAdministrationSupplierSchema.safeParse({ name, categoryIds: ids }).success).toBe(
      false,
    );
    expect(
      CreateAdministrationSupplierSchema.safeParse({ name, categoryIds: ids.slice(1) }).success,
    ).toBe(true);
  });

  it('names categories by the field the refusal names', () => {
    expect(ADMINISTRATION_SUPPLIER_REFERENCE_FIELDS).toEqual(['categoryIds']);
  });
});

describe('the VAT status (OD-11 A; its values arrive with OD-29)', () => {
  it('has no values yet, so none is invented', () => {
    expect(ADMINISTRATION_SUPPLIER_VAT_STATUSES).toEqual([]);
  });

  it('takes null, or nothing, and refuses any value', () => {
    expect(CreateAdministrationSupplierSchema.safeParse({ name, vatStatus: null }).success).toBe(
      true,
    );
    for (const vatStatus of ['registered', 'exempt', '', 14]) {
      expect(
        CreateAdministrationSupplierSchema.safeParse({ name, vatStatus }).success,
        String(vatStatus),
      ).toBe(false);
      expect(
        UpdateAdministrationSupplierSchema.safeParse({ vatStatus, version: 0 }).success,
        String(vatStatus),
      ).toBe(false);
    }
  });
});

describe('a supplier’s update', () => {
  it('updates with a version, and only with one', () => {
    expect(UpdateAdministrationSupplierSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(UpdateAdministrationSupplierSchema.safeParse({ name }).success).toBe(false);
  });

  it('clears a field with null, retires with isActive, and replaces a list whole', () => {
    expect(
      UpdateAdministrationSupplierSchema.parse({
        phone: null,
        taxNumber: null,
        isActive: false,
        contacts: [],
        categoryIds: [oid(3)],
        version: 4,
      }),
    ).toEqual({
      phone: null,
      taxNumber: null,
      isActive: false,
      contacts: [],
      categoryIds: [oid(3)],
      version: 4,
    });
  });

  it.each([{ code: 'SUP-00009' }, { nameKey: 'x' }, { attachments: [] }, { iban: 'EG00' }])(
    'refuses %o',
    (extra) => {
      expect(UpdateAdministrationSupplierSchema.safeParse({ version: 0, ...extra }).success).toBe(
        false,
      );
    },
  );

  it('never clears the name', () => {
    expect(UpdateAdministrationSupplierSchema.safeParse({ name: null, version: 0 }).success).toBe(
      false,
    );
  });
});

describe('the register’s query (§19.4)', () => {
  it('searches, filters by category and status, and pages at most 100', () => {
    expect(
      ListAdministrationSuppliersQuerySchema.parse({
        search: ' نور ',
        categoryId: oid(5),
        isActive: 'true',
      }),
    ).toMatchObject({
      search: 'نور',
      categoryId: oid(5),
      isActive: true,
      page: 1,
      pageSize: 25,
      sortDir: 'desc',
    });
    expect(ListAdministrationSuppliersQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(ListAdministrationSuppliersQuerySchema.safeParse({ branchId: oid(1) }).success).toBe(
      false,
    );
    expect(ListAdministrationSuppliersQuerySchema.safeParse({ categoryId: 'x' }).success).toBe(
      false,
    );
  });
});

describe('the papers (OD-11 A, OD-76 A, OD-77 A)', () => {
  it('file under one category of their own: PDF and images, 10 MB', () => {
    expect(ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY).toBe(
      'administration-supplier-documents',
    );
    // The platform's key pattern (`CreateFileCategorySchema`), so the seed's ensure accepts it.
    expect(ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY).toMatch(/^[a-z][a-z0-9-]{1,49}$/);
    expect([...ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES]).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB).toBe(10);
  });

  it('a link takes a label and the supplier’s version, both from multipart strings', () => {
    expect(
      AddAdministrationSupplierAttachmentSchema.parse({ label: ' السجل التجاري ', version: '3' }),
    ).toEqual({ label: 'السجل التجاري', version: 3 });
    for (const body of [
      { label: 'x' },
      { version: '0' },
      { label: '', version: '0' },
      { label: 'x', version: '-1' },
      { label: 'x', version: '0', categoryId: oid(1) },
    ]) {
      expect(
        AddAdministrationSupplierAttachmentSchema.safeParse(body).success,
        JSON.stringify(body),
      ).toBe(false);
    }
  });

  it('a removal carries the version in its query', () => {
    expect(AdministrationSupplierAttachmentVersionQuerySchema.parse({ version: '2' })).toEqual({
      version: 2,
    });
    expect(AdministrationSupplierAttachmentVersionQuerySchema.safeParse({}).success).toBe(false);
  });

  it('a tax-number warning names a handful of other holders, not a report', () => {
    expect(ADMINISTRATION_SUPPLIER_TAX_NUMBER_MATCHES).toBe(5);
  });
});
