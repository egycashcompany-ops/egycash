// The supplier contracts, pinned (design §2.3.6, §11.2, §19.4, §19.7): every write schema is strict,
// so a client-sent `code` or `nameKey`, a bank field, a stock figure or a paper smuggled into the
// body is refused instead of dropped; a supplier lists at most 20 contacts (a 21st is refused); the
// VAT status takes no value until OD-29 gives the values; an update carries its version, and so do
// a paper's link and removal; and the papers' category takes PDF and images only (OD-76 (i)).
//
// The purchase request (P2.2; phase-2 §5, §12.1): its write schemas strict, a line naming an item
// with an integer quantity from 1 to 1,000,000, at most 100 lines, `neededBy` a real date, an
// edit's line ids each sent once; the register's comma lists and their bounds; and each guard set
// pinned, one reason per status (design §5.16 spec 8). The submission (P2.3): a version and
// nothing else, and the reasons a draft is refused it.
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATION_PURCHASE_REQUEST_ACTIONS,
  ADMINISTRATION_PURCHASE_REQUEST_ACTION_REASONS,
  ADMINISTRATION_PURCHASE_REQUEST_ORDER_STATUSES,
  ADMINISTRATION_PURCHASE_REQUEST_STATUSES,
  ADMINISTRATION_PURCHASE_REQUEST_SUBMIT_PROBLEMS,
  APPROVAL_PENDING,
  CONTENT_EDITABLE,
  CreateAdministrationPurchaseRequestSchema,
  ListAdministrationPurchaseRequestsQuerySchema,
  PR_CANCELLABLE,
  PR_SOURCEABLE,
  SubmitAdministrationPurchaseRequestSchema,
  UpdateAdministrationPurchaseRequestSchema,
  type AdministrationPurchaseRequestGuardSet,
  type AdministrationPurchaseRequestStatus,
  ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY,
  ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB,
  ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES,
  ADMINISTRATION_SUPPLIER_MAX_CATEGORIES,
  ADMINISTRATION_SUPPLIER_MAX_CONTACTS,
  ADMINISTRATION_SUPPLIER_REFERENCE_FIELDS,
  ADMINISTRATION_SUPPLIER_MAX_TAX_NUMBER_MATCHES,
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
    expect(ADMINISTRATION_SUPPLIER_MAX_TAX_NUMBER_MATCHES).toBe(5);
  });
});

describe('a purchase request’s create (P2.2)', () => {
  const line = (n = 1) => ({ itemId: oid(n), qty: 3 });

  it('takes the lines alone, and the request’s three texts', () => {
    expect(CreateAdministrationPurchaseRequestSchema.parse({ lines: [] })).toEqual({ lines: [] });
    expect(
      CreateAdministrationPurchaseRequestSchema.parse({
        neededBy: '2026-12-01',
        justification: ' مستلزمات الربع الأول ',
        notes: 'تسليم المخزن الرئيسي',
        lines: [{ ...line(), notes: ' عاجل ' }],
      }),
    ).toEqual({
      neededBy: '2026-12-01',
      justification: 'مستلزمات الربع الأول',
      notes: 'تسليم المخزن الرئيسي',
      lines: [{ itemId: oid(1), qty: 3, notes: 'عاجل' }],
    });
  });

  it.each([
    ['the requester', { requesterUserId: oid(9) }],
    ['a branch', { branchId: oid(9) }],
    ['a department', { departmentId: oid(9) }],
    ['a number', { number: 'PR-2026-000001' }],
    ['a status', { status: 'approved' }],
  ])('refuses %s in the body — the server’s, never the client’s', (_label, extra) => {
    expect(
      CreateAdministrationPurchaseRequestSchema.safeParse({ lines: [], ...extra }).success,
    ).toBe(false);
  });

  it('refuses a line with a unit, a counter or free text — the item names them (OD-07, OD-14 C)', () => {
    for (const extra of [
      { unitId: oid(5) },
      { cancelledQty: 1 },
      { orderedQty: 0 },
      { description: 'ورق' },
    ]) {
      expect(
        CreateAdministrationPurchaseRequestSchema.safeParse({ lines: [{ ...line(), ...extra }] })
          .success,
        JSON.stringify(extra),
      ).toBe(false);
    }
    expect(
      CreateAdministrationPurchaseRequestSchema.safeParse({ lines: [{ qty: 1 }] }).success,
      'a line names an item',
    ).toBe(false);
  });

  it('takes 100 lines and refuses the 101st', () => {
    const lines = (count: number) => Array.from({ length: count }, (_, i) => line(i + 1));
    expect(CreateAdministrationPurchaseRequestSchema.safeParse({ lines: lines(100) }).success).toBe(
      true,
    );
    expect(CreateAdministrationPurchaseRequestSchema.safeParse({ lines: lines(101) }).success).toBe(
      false,
    );
  });

  it('takes a whole quantity from 1 to 1,000,000, and nothing else', () => {
    const parses = (qty: unknown) =>
      CreateAdministrationPurchaseRequestSchema.safeParse({ lines: [{ itemId: oid(1), qty }] })
        .success;
    expect(parses(1)).toBe(true);
    expect(parses(1_000_000)).toBe(true);
    for (const qty of [0, -1, 1_000_001, 1.5, '3']) expect(parses(qty), String(qty)).toBe(false);
  });

  it('takes a real YYYY-MM-DD date for neededBy, a past one included, and nothing else', () => {
    const parses = (neededBy: unknown) =>
      CreateAdministrationPurchaseRequestSchema.safeParse({ neededBy, lines: [] }).success;
    expect(parses('2020-01-31'), 'a returned draft may carry a past date').toBe(true);
    for (const neededBy of ['2026-02-30', '01/12/2026', '2026-12-01T00:00:00Z', '']) {
      expect(parses(neededBy), neededBy).toBe(false);
    }
  });

  it('bounds the texts as the catalog does: 2,000 for the request’s, 500 for a line’s', () => {
    expect(
      CreateAdministrationPurchaseRequestSchema.safeParse({
        justification: 'x'.repeat(2001),
        lines: [],
      }).success,
    ).toBe(false);
    expect(
      CreateAdministrationPurchaseRequestSchema.safeParse({
        lines: [{ ...line(), notes: 'x'.repeat(501) }],
      }).success,
    ).toBe(false);
  });
});

describe('a purchase request’s draft edit (P2.2)', () => {
  it('carries its version; null clears a text; lines replace the list, a kept line with its id', () => {
    expect(
      UpdateAdministrationPurchaseRequestSchema.parse({
        neededBy: null,
        notes: null,
        lines: [
          { lineId: oid(1), itemId: oid(2), qty: 2 },
          { itemId: oid(3), qty: 1 },
        ],
        version: 4,
      }),
    ).toEqual({
      neededBy: null,
      notes: null,
      lines: [
        { lineId: oid(1), itemId: oid(2), qty: 2 },
        { itemId: oid(3), qty: 1 },
      ],
      version: 4,
    });
    expect(UpdateAdministrationPurchaseRequestSchema.safeParse({ notes: 'x' }).success).toBe(false);
  });

  it('refuses one line id sent twice, in any case — two lines must never become one', () => {
    const twice = (second: string) =>
      UpdateAdministrationPurchaseRequestSchema.safeParse({
        lines: [
          { lineId: 'aaaaaaaaaaaaaaaaaaaaaaaa', itemId: oid(2), qty: 1 },
          { lineId: second, itemId: oid(3), qty: 1 },
        ],
        version: 0,
      });
    const refused = twice('AAAAAAAAAAAAAAAAAAAAAAAA');
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.path).toEqual(['lines', 1, 'lineId']);
    expect(twice(oid(9)).success).toBe(true);
  });

  it('refuses a status or a requester, and 101 lines', () => {
    for (const extra of [{ status: 'draft' }, { requesterUserId: oid(1) }]) {
      expect(
        UpdateAdministrationPurchaseRequestSchema.safeParse({ ...extra, version: 0 }).success,
      ).toBe(false);
    }
    const lines = Array.from({ length: 101 }, (_, i) => ({ itemId: oid(i + 1), qty: 1 }));
    expect(UpdateAdministrationPurchaseRequestSchema.safeParse({ lines, version: 0 }).success).toBe(
      false,
    );
  });
});

describe('a purchase request’s submission (P2.3)', () => {
  it('carries the version it was read at, and nothing else — the number and the chain are the server’s', () => {
    expect(SubmitAdministrationPurchaseRequestSchema.parse({ version: 3 })).toEqual({ version: 3 });
    for (const body of [
      {},
      { version: -1 },
      { version: 1.5 },
      { version: 0, number: 'PR-2026-000001' },
      { version: 0, approvalWorkflowId: oid(1) },
    ]) {
      expect(
        SubmitAdministrationPurchaseRequestSchema.safeParse(body).success,
        JSON.stringify(body),
      ).toBe(false);
    }
  });

  it('names the reasons a draft is refused its submission, its copy’s move among them', () => {
    // ADMINISTRATION_TRANSITION_BLOCKED's detail codes on a submission (design §5.4 row 2, §7.6).
    expect([...ADMINISTRATION_PURCHASE_REQUEST_SUBMIT_PROBLEMS]).toEqual([
      'noLines',
      'notPositive',
      'itemMissing',
      'itemInactive',
      'copyMoved',
    ]);
  });
});

describe('the purchase request register’s query (P2.2)', () => {
  it('sorts by created, newest first, unless asked for a number, a submission or a need date', () => {
    expect(ListAdministrationPurchaseRequestsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      sortBy: 'createdAt',
      sortDir: 'desc',
    });
    for (const sortBy of ['number', 'createdAt', 'submittedAt', 'neededBy']) {
      expect(ListAdministrationPurchaseRequestsQuerySchema.parse({ sortBy }).sortBy).toBe(sortBy);
    }
    expect(
      ListAdministrationPurchaseRequestsQuerySchema.safeParse({ sortBy: 'status' }).success,
    ).toBe(false);
  });

  it('reads status and departmentIds as comma lists', () => {
    const parsed = ListAdministrationPurchaseRequestsQuerySchema.parse({
      status: 'draft,pendingApproval',
      departmentIds: `${oid(1)},${oid(2)}`,
    });
    expect(parsed.status).toEqual(['draft', 'pendingApproval']);
    expect(parsed.departmentIds).toEqual([oid(1), oid(2)]);
    expect(
      ListAdministrationPurchaseRequestsQuerySchema.safeParse({ status: 'draft,shipped' }).success,
    ).toBe(false);
  });

  it('takes 200 department copies — a company department sends every copy it has — and refuses 201', () => {
    const copies = (count: number) => Array.from({ length: count }, (_, i) => oid(i + 1)).join(',');
    expect(
      ListAdministrationPurchaseRequestsQuerySchema.safeParse({ departmentIds: copies(200) })
        .success,
    ).toBe(true);
    expect(
      ListAdministrationPurchaseRequestsQuerySchema.safeParse({ departmentIds: copies(201) })
        .success,
    ).toBe(false);
  });

  it('bounds the days by Cairo dates, and refuses an unknown filter', () => {
    expect(
      ListAdministrationPurchaseRequestsQuerySchema.parse({ from: '2026-03-01', to: '2026-03-31' }),
    ).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    for (const query of [
      { from: '2026-13-01' },
      { to: 'yesterday' },
      { orderStatus: 'notOrdered' },
    ]) {
      expect(
        ListAdministrationPurchaseRequestsQuerySchema.safeParse(query).success,
        JSON.stringify(query),
      ).toBe(false);
    }
  });
});

describe('the purchase request’s statuses and guard sets (design §5.14; spec 8)', () => {
  it('declares design §5.4’s six statuses and §5.12’s three order statuses', () => {
    expect([...ADMINISTRATION_PURCHASE_REQUEST_STATUSES]).toEqual([
      'draft',
      'pendingApproval',
      'approved',
      'rejected',
      'cancelled',
      'closed',
    ]);
    expect([...ADMINISTRATION_PURCHASE_REQUEST_ORDER_STATUSES]).toEqual([
      'notOrdered',
      'partiallyOrdered',
      'fullyOrdered',
    ]);
  });

  /** Each set, every status, and the reason it is in or out. */
  const SETS: Record<
    string,
    [AdministrationPurchaseRequestGuardSet, Record<AdministrationPurchaseRequestStatus, string>]
  > = {
    PR_SOURCEABLE: [
      PR_SOURCEABLE,
      {
        draft: 'out — not yet approved',
        pendingApproval: 'out — not yet approved',
        approved: 'in — the approved need an RFQ or a PO cites',
        rejected: 'out — refused for good',
        cancelled: 'out — ended',
        closed: 'out — every line ordered or cancelled',
      },
    ],
    APPROVAL_PENDING: [
      APPROVAL_PENDING,
      {
        draft: 'out — nobody decides a draft',
        pendingApproval: 'in — the chain decides it',
        approved: 'out — the chain is settled',
        rejected: 'out — the chain is settled',
        cancelled: 'out — ended',
        closed: 'out — ended',
      },
    ],
    CONTENT_EDITABLE: [
      CONTENT_EDITABLE,
      {
        draft: 'in — its requester composes it',
        pendingApproval: 'out — the approvers decide what was submitted',
        approved: 'out — what was approved is what is sourced',
        rejected: 'out — refused for good',
        cancelled: 'out — ended',
        closed: 'out — ended',
      },
    ],
    PR_CANCELLABLE: [
      PR_CANCELLABLE,
      {
        draft: 'in — row 6',
        pendingApproval: 'in — row 7',
        approved: 'in — row 8, while nothing is ordered',
        rejected: 'out — already final',
        cancelled: 'out — already final',
        closed: 'out — already final',
      },
    ],
  };

  it.each(Object.entries(SETS))('%s classifies every status as its reasons say', (_name, entry) => {
    const [set, reasons] = entry;
    expect(Object.keys(set).sort()).toEqual([...ADMINISTRATION_PURCHASE_REQUEST_STATUSES].sort());
    for (const status of ADMINISTRATION_PURCHASE_REQUEST_STATUSES) {
      expect(set[status], `${status}: ${reasons[status]}`).toBe(reasons[status].startsWith('in'));
    }
  });
});

describe('the acts a purchase request’s record offers (phase-2 §4.4)', () => {
  it('lists the six acts in the order a screen shows them, and the five reasons', () => {
    expect([...ADMINISTRATION_PURCHASE_REQUEST_ACTIONS]).toEqual([
      'edit',
      'submit',
      'decide',
      'return',
      'cancel',
      'withdraw',
    ]);
    expect([...ADMINISTRATION_PURCHASE_REQUEST_ACTION_REASONS]).toEqual([
      'notRequester',
      'notYourStep',
      'separationOfDuties',
      'decided',
      'outOfReach',
    ]);
  });
});
