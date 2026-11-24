// Administrative Affairs' supplier register over real HTTP, real RBAC, real Files and a real
// database (design §19.7, P1b.1).
//
// What a mocked spec cannot see: the folded name stored and indexed, so «قطعه» typed beside «قطعة»
// is one supplier even when the two are typed at the same moment, where only the unique index can
// refuse the second; the «SUP-» code taken inside a real transaction, so concurrent creates get
// consecutive numbers and a create the index refuses gives its number back; a repeated tax number
// saved and warned about, never refused (OD-11 (i)); the categories a supplier names read by a
// supplier editor and judged against real rows; the writes held to organization scope (OD-04 A),
// papers included, while the reads are not; and the papers themselves — filed under the supplier
// through the platform's Files, read back `private, no-store`, refused while a scan is pending or
// after it blocked the file, never served for another supplier, and asked of the module's
// authorizer by the platform's own file paths.
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import {
  foldName,
  parseAdministrationMasterCode,
  type AdministrationItemCategoryDto,
  type AdministrationSupplierDetailDto,
  type AdministrationSupplierDto,
  type DataScope,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FileCategoryModel } from '../../src/platform/files/file-category.model';
import { FileModel } from '../../src/platform/files/file.model';
import { hasFileEntityAuthorizer } from '../../src/platform/files';
import { RoleModel } from '../../src/platform/rbac/role.model';
import { AdministrationSupplierModel } from '../../src/modules/administration/procurement/suppliers/supplier.model';
import { administrationSupplierRepository } from '../../src/modules/administration/procurement/suppliers/supplier.repository';
import { supplierFileAuthorizer } from '../../src/modules/administration/procurement/suppliers';
import { AdministrationCounterModel } from '../../src/modules/administration/shared/counter.model';
import { seedAdministration } from '../../src/modules/administration/administration.seed';
import { type AuthContext } from '../../src/shared/types';
import {
  administrationApi,
  bootAdministration,
  data,
  refusal,
  stopAdministration,
  type AdministrationWorld,
} from './helpers/administration-fixtures';

let world: AdministrationWorld;
/** The supplier desk: the supplier keys at organization scope, and nothing else. */
let api: ReturnType<typeof administrationApi>;
/** The master-data desk, which keeps the categories a supplier names. */
let catalog: ReturnType<typeof administrationApi>;

beforeAll(async () => {
  world = await bootAdministration('suppliers');
  api = administrationApi(world.app, world.supplierManagerToken);
  catalog = administrationApi(world.app, world.managerToken);
}, 240_000);

afterAll(async () => {
  await stopAdministration();
});

// Every case its own names: two cases never share a supplier or a category.
let serial = 0;
const fresh = (ar: string, en: string) => {
  serial += 1;
  return { ar: `${ar} ${String(serial)}`, en: `${en} ${String(serial)}` };
};

const supplier = async (
  body: Record<string, unknown> = {},
): Promise<AdministrationSupplierDetailDto> => {
  const res = await api.post('/suppliers', { name: fresh('مورد', 'Supplier'), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AdministrationSupplierDetailDto>(res);
};

const category = async (
  body: Record<string, unknown> = {},
): Promise<AdministrationItemCategoryDto> => {
  const res = await catalog.post('/item-categories', {
    name: fresh('تصنيف', 'Category'),
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AdministrationItemCategoryDto>(res);
};

/** The number a «SUP-…» code carries. */
const seqOf = (code: string): number => {
  const parsed = parseAdministrationMasterCode(code);
  expect(parsed?.kind, code).toBe('supplier');
  return parsed?.seq ?? Number.NaN;
};

const refused = (res: request.Response, status: number, code: string, fields?: string[]): void => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const error = refusal(res);
  expect(error.code).toBe(code);
  if (fields !== undefined) expect(error.details?.map((d) => d.field)).toEqual(fields);
};

const trail = (entityId: string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'administration',
    'entityRef.entityType': 'supplier',
    'entityRef.entityId': entityId,
  })
    .sort({ _id: 1 })
    .lean()
    .exec();

const pdf = (label = 'x') => ({
  buffer: Buffer.from(`%PDF-1.4 supplier paper ${label}`),
  filename: `${label}.pdf`,
  contentType: 'application/pdf',
});

/** Link one paper as `who`, against the version they hold. */
const linkPaper = (
  who: ReturnType<typeof administrationApi>,
  doc: { id: string; version: number },
  label = 'السجل التجاري',
  file = pdf(),
) => who.upload(`/suppliers/${doc.id}/attachments`, { label, version: String(doc.version) }, file);

/** A paper's bytes, read whole: superagent keeps no body of its own for a PDF. */
const readBytes = (who: ReturnType<typeof administrationApi>, path: string) =>
  who
    .get(path)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        done(null, Buffer.concat(chunks));
      });
    });

const paperFileId = async (supplierId: string, attachmentId: string): Promise<string> => {
  const row = await AdministrationSupplierModel.findById(supplierId).lean().exec();
  const paper = row?.attachments.find((entry) => String(entry.attachmentId) === attachmentId);
  expect(paper, 'the paper is linked').toBeDefined();
  return String(paper?.fileId);
};

describe('the seed', () => {
  it('builds the supplier’s indexes, the folded name’s unique one among them', async () => {
    const names = async () =>
      (await AdministrationSupplierModel.collection.indexes()).map((index) => index.name);
    await AdministrationSupplierModel.init();
    await AdministrationSupplierModel.collection.dropIndexes();
    expect(await names()).toEqual(['_id_']);
    await seedAdministration();
    expect(await names()).toEqual(
      expect.arrayContaining([
        'ux_code',
        'ux_name_key',
        'ix_tax_number',
        'ix_active',
        'ix_category',
      ]),
    );
  });

  it('raises a lost supplier counter above every «SUP-» code already given, and no item code (§2.8)', async () => {
    const planted = (code: string, ar: string) => ({
      code,
      name: { ar, en: code },
      nameKey: foldName(ar),
    });
    await AdministrationSupplierModel.create([
      planted('SUP-99999', 'مورد مزروع أول'),
      planted('SUP-100000', 'مورد مزروع ثان'),
      planted('SUP-0000200', 'مورد مكتوب باليد'),
    ]);
    await AdministrationCounterModel.deleteMany({ key: 'supplier:global' }).exec();
    await seedAdministration();
    const counter = await AdministrationCounterModel.findOne({ key: 'supplier:global' })
      .lean()
      .exec();
    expect(counter?.seq).toBe(100_000);
    const next = await supplier();
    expect(next.code).toBe('SUP-100001');
  });

  it('ensures the papers’ category: PDF and images, 10 MB, kept for ever (OD-76 (i), OD-77 A)', async () => {
    const row = await FileCategoryModel.findOne({ key: 'administration-supplier-documents' })
      .lean()
      .exec();
    expect(row).toMatchObject({
      name: { ar: 'مستندات الموردين', en: 'Supplier documents' },
      allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      maxSizeMb: 10,
      retentionDays: null,
      status: 'active',
    });
  });

  it('gives every ready-made role its supplier keys, the writes to the master-data desk alone', async () => {
    const roles = await RoleModel.find({ key: /^administration-/ })
      .lean()
      .exec();
    const keysOf = (key: string) =>
      [...(roles.find((role) => role.key === key)?.permissionKeys ?? [])].filter((k) =>
        k.startsWith('administrationSupplier.'),
      );
    for (const key of [
      'administration-storekeeper',
      'administration-procurement-officer',
      'administration-procurement-manager',
      'administration-affairs-manager',
      'administration-auditor',
    ]) {
      expect(keysOf(key), key).toEqual(['administrationSupplier.view']);
    }
    expect(keysOf('administration-master-data').sort()).toEqual([
      'administrationSupplier.create',
      'administrationSupplier.edit',
      'administrationSupplier.view',
    ]);
  });

  it('registers the papers’ authorizer for `administration/supplier` (ADR-023)', () => {
    expect(hasFileEntityAuthorizer('administration', 'supplier')).toBe(true);
  });
});

describe('the register', () => {
  it('creates a supplier with a generated code and the OD-11 A fields; the folded name stays on the server', async () => {
    const tools = await category({ name: fresh('أدوات', 'Tools') });
    const created = await supplier({
      name: { ar: 'شركة الأمل للتوريدات', en: 'Al Amal Supplies' },
      phone: '0225551234',
      email: 'sales@alamal.example',
      address: 'القاهرة — مدينة نصر',
      contacts: [{ name: 'أحمد', role: 'مبيعات', phone: '01001234567' }],
      categoryIds: [tools.id],
      taxNumber: '100-200-300',
      commercialRegistry: '55443',
      paymentTerms: 'آجل 30 يومًا',
      notes: 'مورد الأدوات',
    });
    expect(created).toMatchObject({
      name: { ar: 'شركة الأمل للتوريدات', en: 'Al Amal Supplies' },
      phone: '0225551234',
      contacts: [{ name: 'أحمد', role: 'مبيعات', phone: '01001234567', email: null }],
      categories: [{ id: tools.id, name: tools.name }],
      taxNumber: '100-200-300',
      commercialRegistry: '55443',
      vatStatus: null,
      paymentTerms: 'آجل 30 يومًا',
      isActive: true,
      version: 0,
      attachments: [],
      taxNumberMatches: [],
    });
    expect(seqOf(created.code)).toBeGreaterThan(0);
    expect(created).not.toHaveProperty('nameKey');
    const stored = await AdministrationSupplierModel.findById(created.id).lean().exec();
    expect(stored?.nameKey).toBe(foldName('شركة الأمل للتوريدات'));
    expect(stored?.categoryIds.map(String)).toEqual([tools.id]);

    const got = await api.get(`/suppliers/${created.id}`);
    expect(got.status).toBe(200);
    expect(data<AdministrationSupplierDetailDto>(got)).toMatchObject({ code: created.code });
  });

  it('finds a supplier by its code, and by another spelling of its name', async () => {
    const nour = await supplier({ name: { ar: 'مؤسسة النور للأثاث', en: 'Al Nour Furniture' } });
    for (const search of [nour.code, 'مؤسسه النور للاثاث', 'nour furniture']) {
      const res = await api.get(`/suppliers?search=${encodeURIComponent(search)}`);
      expect(res.status).toBe(200);
      expect(
        data<AdministrationSupplierDto[]>(res).map((row) => row.id),
        search,
      ).toContain(nour.id);
    }
  });

  it('filters by category — a top-level category holds its subcategories’ suppliers — and by status', async () => {
    const top = await category();
    const sub = await category({ parentId: top.id });
    const other = await category();
    const onSub = await supplier({ categoryIds: [sub.id] });
    const onTop = await supplier({ categoryIds: [top.id] });
    const elsewhere = await supplier({ categoryIds: [other.id] });
    const ids = async (query: string) =>
      data<AdministrationSupplierDto[]>(await api.get(`/suppliers?${query}`)).map((row) => row.id);

    expect((await ids(`categoryId=${top.id}&pageSize=100`)).sort()).toEqual(
      [onSub.id, onTop.id].sort(),
    );
    expect(await ids(`categoryId=${sub.id}`)).toEqual([onSub.id]);
    expect(await ids(`categoryId=${top.id}`)).not.toContain(elsewhere.id);

    await api.patch(`/suppliers/${elsewhere.id}`, { isActive: false, version: 0 });
    expect(await ids(`categoryId=${other.id}&isActive=false`)).toEqual([elsewhere.id]);
    expect(await ids(`categoryId=${other.id}&isActive=true`)).toEqual([]);
  });

  it('sorts by code, and pages at most 100 rows', async () => {
    const res = await api.get('/suppliers?sortBy=code&sortDir=asc&pageSize=100');
    expect(res.status).toBe(200);
    const codes = data<AdministrationSupplierDto[]>(res).map((row) => row.code);
    expect(codes).toEqual([...codes].sort());
    expect((await api.get('/suppliers?pageSize=101')).status).toBe(400);
  });

  it('edits with its version; a stale version is 409 STALE_DOCUMENT; the code never moves', async () => {
    const created = await supplier();
    const edited = await api.patch(`/suppliers/${created.id}`, {
      email: 'orders@example.test',
      contacts: [{ name: 'منى', email: 'mona@example.test' }],
      version: 0,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(data<AdministrationSupplierDetailDto>(edited)).toMatchObject({
      code: created.code,
      email: 'orders@example.test',
      contacts: [{ name: 'منى', role: null, phone: null, email: 'mona@example.test' }],
      version: 1,
    });
    refused(
      await api.patch(`/suppliers/${created.id}`, { notes: 'late', version: 0 }),
      409,
      'STALE_DOCUMENT',
    );
    refused(
      await api.patch(`/suppliers/${created.id}`, { code: 'SUP-99999', version: 1 }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('deactivates freely and comes back: `deactivate`, then `activate`; a retired supplier still resolves by id', async () => {
    const created = await supplier();
    const retired = await api.patch(`/suppliers/${created.id}`, {
      isActive: false,
      version: 0,
    });
    expect(retired.status).toBe(200);
    const got = await api.get(`/suppliers/${created.id}`);
    expect(data<AdministrationSupplierDetailDto>(got)).toMatchObject({ isActive: false });
    const back = await api.patch(`/suppliers/${created.id}`, { isActive: true, version: 1 });
    expect(back.status).toBe(200);
    expect((await trail(created.id)).map((row) => row.action)).toEqual([
      'create',
      'deactivate',
      'activate',
    ]);
  });

  it('a GET of an id no supplier has is 404, and a malformed id 400', async () => {
    refused(await api.get(`/suppliers/${String(new Types.ObjectId())}`), 404, 'NOT_FOUND');
    refused(await api.get('/suppliers/not-an-id'), 400, 'VALIDATION_FAILED');
  });

  it('refuses a 21st contact person: 400 VALIDATION_FAILED', async () => {
    const contacts = Array.from({ length: 21 }, (_, i) => ({ name: `Contact ${String(i)}` }));
    refused(
      await api.post('/suppliers', { name: fresh('مورد', 'Supplier'), contacts }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('takes no VAT status until OD-29 gives the values, and no bank data at all', async () => {
    for (const extra of [{ vatStatus: 'registered' }, { iban: 'EG00' }, { bankAccount: '1' }]) {
      refused(
        await api.post('/suppliers', { name: fresh('مورد', 'Supplier'), ...extra }),
        400,
        'VALIDATION_FAILED',
      );
    }
  });
});

describe('one name per live supplier: 409 ADMINISTRATION_DUPLICATE', () => {
  it('refuses a second spelling of a live supplier’s name, and a retired supplier keeps its name', async () => {
    await supplier({ name: { ar: 'مكتبة الإيمان', en: 'Al Iman Bookshop' } });
    refused(
      await api.post('/suppliers', { name: { ar: 'مكتبه الايمان', en: 'Iman' } }),
      409,
      'ADMINISTRATION_DUPLICATE',
      ['name'],
    );
    const retired = await supplier({ name: { ar: 'مطبعة الشروق', en: 'Al Shorouk Press' } });
    await api.patch(`/suppliers/${retired.id}`, { isActive: false, version: 0 });
    refused(
      await api.post('/suppliers', { name: { ar: 'مطبعه الشروق', en: 'Shorouk' } }),
      409,
      'ADMINISTRATION_DUPLICATE',
      ['name'],
    );
  });

  it('refuses a rename onto a live supplier’s name', async () => {
    await supplier({ name: { ar: 'شركة الفجر', en: 'Al Fajr' } });
    const other = await supplier();
    refused(
      await api.patch(`/suppliers/${other.id}`, {
        name: { ar: 'شركه الفجر', en: 'Fajr' },
        version: 0,
      }),
      409,
      'ADMINISTRATION_DUPLICATE',
      ['name'],
    );
  });

  it('two spellings typed at the same moment: one 201, one 409 on name — ux_name_key, inside the transaction', async () => {
    // The design's own pair (§19.7): «قطعه» and «قطعة», one word in two spellings.
    const [first, second] = await Promise.all([
      api.post('/suppliers', { name: { ar: 'قطعه للتوريدات', en: 'Piece A' } }),
      api.post('/suppliers', { name: { ar: 'قطعة للتوريدات', en: 'Piece B' } }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const lost = first.status === 409 ? first : second;
    expect(refusal(lost)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
    expect(
      await AdministrationSupplierModel.countDocuments({
        nameKey: foldName('قطعة للتوريدات'),
      }).exec(),
    ).toBe(1);
  });
});

describe('supplier codes under concurrency (OD-05 A, §19.10.5)', () => {
  it('simultaneous creates all answer 201, with consecutive, distinct codes', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        api.post('/suppliers', { name: fresh('مورد متزامن', 'Concurrent supplier') }),
      ),
    );
    expect(responses.map((res) => res.status)).toEqual(Array.from({ length: 6 }, () => 201));
    const seqs = responses
      .map((res) => seqOf(data<AdministrationSupplierDto>(res).code))
      .sort((a, b) => a - b);
    const first = seqs[0] ?? Number.NaN;
    expect(seqs).toEqual(seqs.map((_, i) => first + i));
  });

  it('a create the index refuses inside its transaction gives its number back — no gap', async () => {
    const before = await supplier({ name: { ar: 'مورد الورق', en: 'Paper supplier' } });
    const spy = vi
      .spyOn(administrationSupplierRepository, 'findLiveByNameKey')
      .mockResolvedValueOnce(null);
    const counter = await AdministrationCounterModel.findOne({ key: 'supplier:global' })
      .lean()
      .exec();
    const raced = await api.post('/suppliers', { name: { ar: 'مورد ألورق', en: 'Paper' } });
    spy.mockRestore();
    refused(raced, 409, 'ADMINISTRATION_DUPLICATE', ['name']);
    const after = await AdministrationCounterModel.findOne({ key: 'supplier:global' })
      .lean()
      .exec();
    expect(after?.seq, 'the number went back with the transaction').toBe(counter?.seq);
    const next = await supplier();
    expect(seqOf(next.code)).toBe(seqOf(before.code) + 1);
  });

  it('counts apart from the item codes: a supplier create moves `supplier:global` alone', async () => {
    const seqOfKey = async (key: string) =>
      (await AdministrationCounterModel.findOne({ key }).lean().exec())?.seq;
    const itemsBefore = await seqOfKey('item:global');
    const created = await supplier();
    expect(created.code).toMatch(/^SUP-\d{5,}$/);
    expect(await seqOfKey('supplier:global')).toBe(seqOf(created.code));
    expect(await seqOfKey('item:global'), 'the item series untouched').toBe(itemsBefore);
  });
});

describe('a repeated tax number is a warning, never a block (OD-11 (i))', () => {
  it('saves both suppliers, and each one’s detail names the other', async () => {
    const head = await supplier({ taxNumber: '777-888-999' });
    const branch = await supplier({ taxNumber: '777-888-999' });
    expect(branch.taxNumberMatches).toEqual([
      { id: head.id, code: head.code, name: head.name, isActive: true },
    ]);
    const headNow = data<AdministrationSupplierDetailDto>(await api.get(`/suppliers/${head.id}`));
    expect(headNow.taxNumberMatches.map((match) => match.id)).toEqual([branch.id]);
  });

  it('warns on an edit onto a held number too, and names a retired holder as retired', async () => {
    const retired = await supplier({ taxNumber: '321-654-987' });
    await api.patch(`/suppliers/${retired.id}`, { isActive: false, version: 0 });
    const other = await supplier();
    const edited = await api.patch(`/suppliers/${other.id}`, {
      taxNumber: '321-654-987',
      version: 0,
    });
    expect(edited.status).toBe(200);
    expect(data<AdministrationSupplierDetailDto>(edited).taxNumberMatches).toEqual([
      expect.objectContaining({ id: retired.id, isActive: false }),
    ]);
  });

  it('names nobody for a supplier without a tax number, or with one no one else holds', async () => {
    expect((await supplier()).taxNumberMatches).toEqual([]);
    expect((await supplier({ taxNumber: '000-111-222' })).taxNumberMatches).toEqual([]);
  });

  it('names at most five holders, newest first', async () => {
    const holders: AdministrationSupplierDetailDto[] = [];
    for (let i = 0; i < 6; i += 1) holders.push(await supplier({ taxNumber: '555-555-555' }));
    const last = await supplier({ taxNumber: '555-555-555' });
    expect(last.taxNumberMatches.map((match) => match.id)).toEqual(
      holders
        .slice(-5)
        .reverse()
        .map((holder) => holder.id),
    );
  });
});

describe('the categories a supplier supplies', () => {
  it('a supplier editor reads the categories — the supplier form’s list — and not the units', async () => {
    await category();
    const res = await api.get('/item-categories');
    expect(res.status).toBe(200);
    expect(data<AdministrationItemCategoryDto[]>(res).length).toBeGreaterThan(0);
    expect((await api.get('/catalog-items?kind=unit')).status).toBe(403);
    // A supplier reader writes nothing, so its key opens no picker (§19.3).
    const viewer = administrationApi(world.app, world.supplierViewerToken);
    expect((await viewer.get('/item-categories')).status).toBe(403);
  });

  it('names each category once, in the order first given, its id as the database spells it', async () => {
    const a = await category();
    const b = await category();
    const created = await supplier({ categoryIds: [b.id.toUpperCase(), a.id, b.id] });
    expect(created.categories.map((entry) => entry.id)).toEqual([b.id, a.id]);
  });

  it('refuses a retired category named anew — 422 ADMINISTRATION_REFERENCE_INACTIVE with its id — and keeps one named before it retired', async () => {
    const kept = await category();
    const retired = await category();
    await catalog.patch(`/item-categories/${retired.id}`, { isActive: false, version: 0 });
    const res = await api.post('/suppliers', {
      name: fresh('مورد', 'Supplier'),
      categoryIds: [kept.id, retired.id],
    });
    refused(res, 422, 'ADMINISTRATION_REFERENCE_INACTIVE', ['categoryIds']);
    expect(refusal(res).details).toEqual([
      expect.objectContaining({ field: 'categoryIds', code: 'inactive', message: retired.id }),
    ]);

    const filed = await supplier({ categoryIds: [kept.id] });
    await catalog.patch(`/item-categories/${kept.id}`, { isActive: false, version: 0 });
    const edited = await api.patch(`/suppliers/${filed.id}`, {
      categoryIds: [kept.id],
      notes: 'still supplies it',
      version: 0,
    });
    expect(edited.status, 'a category it already names is kept').toBe(200);
    expect(data<AdministrationSupplierDetailDto>(edited).categories).toEqual([
      { id: kept.id, name: kept.name },
    ]);
  });

  it('a category that does not exist is 404', async () => {
    refused(
      await api.post('/suppliers', {
        name: fresh('مورد', 'Supplier'),
        categoryIds: [String(new Types.ObjectId())],
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('who may read and write', () => {
  it('403 without the key, on every route', async () => {
    const outsider = administrationApi(world.app, world.outsiderToken);
    const filed = await supplier();
    const linked = await linkPaper(api, filed);
    expect(linked.status).toBe(201);
    const [paper] = data<AdministrationSupplierDetailDto>(linked).attachments;
    const paperPath = `/suppliers/${filed.id}/attachments/${paper?.attachmentId ?? ''}`;
    const answers = {
      'GET /suppliers': await outsider.get('/suppliers'),
      'GET /suppliers/:id': await outsider.get(`/suppliers/${filed.id}`),
      'POST /suppliers': await outsider.post('/suppliers', { name: fresh('مورد', 'Supplier') }),
      'PATCH /suppliers/:id': await outsider.patch(`/suppliers/${filed.id}`, {
        notes: 'x',
        version: 1,
      }),
      'POST …/attachments': await linkPaper(outsider, { id: filed.id, version: 1 }),
      'GET …/attachments/:attachmentId': await outsider.get(paperPath),
      'DELETE …/attachments/:attachmentId': await outsider.delete(`${paperPath}?version=1`),
    };
    for (const [route, res] of Object.entries(answers)) expect(res.status, route).toBe(403);
  });

  it('a supplier reader reads the register, one supplier and its papers, and writes none of it', async () => {
    const viewer = administrationApi(world.app, world.supplierViewerToken);
    const filed = await supplier();
    const linked = data<AdministrationSupplierDetailDto>(await linkPaper(api, filed));
    const [paper] = linked.attachments;
    expect((await viewer.get('/suppliers')).status).toBe(200);
    expect((await viewer.get(`/suppliers/${filed.id}`)).status).toBe(200);
    expect(
      (await viewer.get(`/suppliers/${filed.id}/attachments/${paper?.attachmentId ?? ''}`)).status,
    ).toBe(200);
    expect((await viewer.post('/suppliers', { name: fresh('مورد', 'Supplier') })).status).toBe(403);
    expect((await viewer.patch(`/suppliers/${filed.id}`, { version: 1 })).status).toBe(403);
    expect((await linkPaper(viewer, linked)).status).toBe(403);
  });

  it('403 below organization scope (OD-04 A): a branch holder reads the register but writes none of it, papers included', async () => {
    const branch = administrationApi(world.app, world.branchSupplierManagerToken);
    const filed = await supplier();
    const linked = data<AdministrationSupplierDetailDto>(await linkPaper(api, filed));
    const [paper] = linked.attachments;
    expect((await branch.get('/suppliers')).status).toBe(200);
    expect((await branch.get(`/suppliers/${filed.id}`)).status).toBe(200);
    for (const res of [
      await branch.post('/suppliers', { name: fresh('مورد', 'Supplier') }),
      await branch.patch(`/suppliers/${filed.id}`, { notes: 'x', version: linked.version }),
      await linkPaper(branch, linked),
      await branch.delete(
        `/suppliers/${filed.id}/attachments/${paper?.attachmentId ?? ''}?version=${String(linked.version)}`,
      ),
    ]) {
      refused(res, 403, 'FORBIDDEN');
    }
    const files = await FileModel.countDocuments({
      'entityRef.moduleId': 'administration',
      'entityRef.entityType': 'supplier',
      'entityRef.entityId': filed.id,
    }).exec();
    expect(files, 'the refused upload stored nothing').toBe(1);
  });

  it('the super-admin writes, as an organization holder of every key', async () => {
    const admin = administrationApi(world.app, world.adminToken);
    const res = await admin.post('/suppliers', { name: fresh('مورد', 'Supplier') });
    expect(res.status).toBe(201);
  });
});

describe('the papers (OD-11 A; §11.3–§11.5)', () => {
  it('files a paper under the supplier and its category, and reads it back inline, private, no-store', async () => {
    const filed = await supplier();
    const res = await linkPaper(api, filed, 'البطاقة الضريبية', pdf('tax-card'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const linked = data<AdministrationSupplierDetailDto>(res);
    expect(linked.version, 'a paper’s link is an edit of the record').toBe(filed.version + 1);
    expect(linked.attachments).toEqual([
      expect.objectContaining({
        categoryKey: 'administration-supplier-documents',
        label: 'البطاقة الضريبية',
        fileName: 'tax-card.pdf',
        mime: 'application/pdf',
        scanStatus: 'unscanned',
      }),
    ]);
    expect(linked.attachments[0]).not.toHaveProperty('fileId');

    const attachmentId = linked.attachments[0]?.attachmentId ?? '';
    const fileId = await paperFileId(filed.id, attachmentId);
    const file = await FileModel.findById(fileId).lean().exec();
    expect(file?.entityRef).toEqual({
      moduleId: 'administration',
      entityType: 'supplier',
      entityId: filed.id,
    });
    const categoryRow = await FileCategoryModel.findOne({
      key: 'administration-supplier-documents',
    })
      .lean()
      .exec();
    expect(String(file?.categoryId)).toBe(String(categoryRow?._id));

    const bytes = await readBytes(api, `/suppliers/${filed.id}/attachments/${attachmentId}`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['cache-control']).toBe('private, no-store');
    expect(bytes.headers['content-type']).toContain('application/pdf');
    expect(bytes.headers['content-disposition']).toMatch(
      /^inline; filename\*=UTF-8''tax-card\.pdf$/,
    );
    // The parser above hands the body over as the Buffer it gathered.
    expect((bytes.body as Buffer).toString()).toBe('%PDF-1.4 supplier paper tax-card');

    const rows = await trail(filed.id);
    expect(rows.at(-1)).toMatchObject({
      action: 'update',
      changes: [
        {
          field: 'attachment',
          old: null,
          new: 'administration-supplier-documents:البطاقة الضريبية',
        },
      ],
    });
  });

  it('keeps an Arabic file name as it was typed', async () => {
    const filed = await supplier();
    const res = await linkPaper(api, filed, 'سجل', {
      ...pdf(),
      filename: 'السجل التجاري.pdf',
    });
    expect(data<AdministrationSupplierDetailDto>(res).attachments[0]?.fileName).toBe(
      'السجل التجاري.pdf',
    );
  });

  it('takes PDF and images only (OD-76 (i)): an Office file is 422 FILE_TYPE_NOT_ALLOWED and stores nothing', async () => {
    const filed = await supplier();
    const png = await linkPaper(api, filed, 'صورة', {
      buffer: Buffer.from('png-bytes'),
      filename: 'photo.png',
      contentType: 'image/png',
    });
    expect(png.status).toBe(201);
    const docx = await linkPaper(api, { id: filed.id, version: 1 }, 'عقد', {
      buffer: Buffer.from('docx-bytes'),
      filename: 'contract.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    refused(docx, 422, 'FILE_TYPE_NOT_ALLOWED');
    const now = data<AdministrationSupplierDetailDto>(await api.get(`/suppliers/${filed.id}`));
    expect(now.attachments.map((paper) => paper.label)).toEqual(['صورة']);
    expect(now.version).toBe(1);
  });

  it('a link sent against an older version is 409 STALE_DOCUMENT, before a byte is stored', async () => {
    const filed = await supplier();
    await api.patch(`/suppliers/${filed.id}`, { notes: 'moved on', version: 0 });
    refused(await linkPaper(api, filed), 409, 'STALE_DOCUMENT');
    const files = await FileModel.countDocuments({ 'entityRef.entityId': filed.id }).exec();
    expect(files).toBe(0);
  });

  it('a link with no file, or no label, is 400 VALIDATION_FAILED', async () => {
    const filed = await supplier();
    const noFile = await api.post(`/suppliers/${filed.id}/attachments`, {
      label: 'x',
      version: 0,
    });
    refused(noFile, 400, 'VALIDATION_FAILED');
    refused(
      await api.upload(`/suppliers/${filed.id}/attachments`, { version: '0' }, pdf()),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('holds at most 20 papers: a 21st is 422 ADMINISTRATION_ATTACHMENT_LIMIT, its upload withdrawn', async () => {
    let doc: { id: string; version: number } = await supplier();
    for (let i = 0; i < 20; i += 1) {
      const res = await linkPaper(api, doc, `ورقة ${String(i)}`, pdf(String(i)));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      doc = data<AdministrationSupplierDetailDto>(res);
    }
    refused(await linkPaper(api, doc, 'زائدة'), 422, 'ADMINISTRATION_ATTACHMENT_LIMIT', [
      'attachments',
    ]);
    const live = await FileModel.countDocuments({
      'entityRef.entityId': doc.id,
      isDeleted: false,
    }).exec();
    expect(live, 'no file is left that no link names').toBe(20);
  });

  it('removes a paper’s LINK under its version — the file itself stays in Files', async () => {
    const filed = await supplier();
    const linked = data<AdministrationSupplierDetailDto>(await linkPaper(api, filed, 'قديمة'));
    const attachmentId = linked.attachments[0]?.attachmentId ?? '';
    const fileId = await paperFileId(filed.id, attachmentId);

    refused(
      await api.delete(`/suppliers/${filed.id}/attachments/${attachmentId}?version=0`),
      409,
      'STALE_DOCUMENT',
    );
    refused(
      await api.delete(`/suppliers/${filed.id}/attachments/${attachmentId}`),
      400,
      'VALIDATION_FAILED',
    );
    const removed = await api.delete(
      `/suppliers/${filed.id}/attachments/${attachmentId}?version=${String(linked.version)}`,
    );
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(data<AdministrationSupplierDetailDto>(removed)).toMatchObject({
      attachments: [],
      version: linked.version + 1,
    });
    const file = await FileModel.findById(fileId).lean().exec();
    expect(file?.isDeleted, 'the link went, the file stayed').toBe(false);
    refused(await api.get(`/suppliers/${filed.id}/attachments/${attachmentId}`), 404, 'NOT_FOUND');
    expect((await trail(filed.id)).at(-1)).toMatchObject({
      action: 'update',
      changes: [{ field: 'attachment', old: 'administration-supplier-documents:قديمة', new: null }],
    });
  });

  it('links only the file uploaded with it — naming another file, of any category or entity, is refused', async () => {
    const owner = await supplier();
    const linked = data<AdministrationSupplierDetailDto>(await linkPaper(api, owner));
    const foreign = await paperFileId(owner.id, linked.attachments[0]?.attachmentId ?? '');
    const target = await supplier();
    refused(
      await api.upload(
        `/suppliers/${target.id}/attachments`,
        { label: 'منقولة', version: '0', fileId: foreign },
        pdf(),
      ),
      400,
      'VALIDATION_FAILED',
    );
    const json = await api.post(`/suppliers/${target.id}/attachments`, {
      label: 'منقولة',
      version: 0,
      fileId: foreign,
    });
    refused(json, 400, 'VALIDATION_FAILED');
    const now = data<AdministrationSupplierDetailDto>(await api.get(`/suppliers/${target.id}`));
    expect(now.attachments).toEqual([]);
  });

  it('never serves or removes a paper through another supplier: 404', async () => {
    const owner = await supplier();
    const stranger = await supplier();
    const linked = data<AdministrationSupplierDetailDto>(await linkPaper(api, owner));
    const attachmentId = linked.attachments[0]?.attachmentId ?? '';
    refused(
      await api.get(`/suppliers/${stranger.id}/attachments/${attachmentId}`),
      404,
      'NOT_FOUND',
    );
    refused(
      await api.delete(`/suppliers/${stranger.id}/attachments/${attachmentId}?version=0`),
      404,
      'NOT_FOUND',
    );
    refused(
      await api.get(`/suppliers/${owner.id}/attachments/${String(new Types.ObjectId())}`),
      404,
      'NOT_FOUND',
    );
    const still = data<AdministrationSupplierDetailDto>(await api.get(`/suppliers/${owner.id}`));
    expect(still.attachments.map((paper) => paper.attachmentId)).toEqual([attachmentId]);
  });

  it('shows each paper’s scan state, and refuses the bytes while pending (FILE_SCAN_PENDING) or once blocked (FILE_BLOCKED)', async () => {
    const filed = await supplier();
    const linked = data<AdministrationSupplierDetailDto>(await linkPaper(api, filed));
    const attachmentId = linked.attachments[0]?.attachmentId ?? '';
    const fileId = await paperFileId(filed.id, attachmentId);
    const stateNow = async () =>
      data<AdministrationSupplierDetailDto>(await api.get(`/suppliers/${filed.id}`)).attachments[0]
        ?.scanStatus;
    const bytes = () => api.get(`/suppliers/${filed.id}/attachments/${attachmentId}`);

    await FileModel.updateOne({ _id: fileId }, { $set: { scanStatus: 'pending' } }).exec();
    expect(await stateNow()).toBe('pending');
    refused(await bytes(), 422, 'FILE_SCAN_PENDING');

    await FileModel.updateOne({ _id: fileId }, { $set: { scanStatus: 'blocked' } }).exec();
    expect(await stateNow()).toBe('blocked');
    refused(await bytes(), 422, 'FILE_BLOCKED');

    await FileModel.updateOne({ _id: fileId }, { $set: { scanStatus: 'clean' } }).exec();
    expect(await stateNow()).toBe('clean');
    expect((await bytes()).status).toBe(200);
  });

  it('reads null for a paper whose file is gone or archived — «الملف غير متاح»', async () => {
    const filed = await supplier();
    const linked = data<AdministrationSupplierDetailDto>(await linkPaper(api, filed));
    const attachmentId = linked.attachments[0]?.attachmentId ?? '';
    const fileId = await paperFileId(filed.id, attachmentId);
    await FileModel.updateOne({ _id: fileId }, { $set: { status: 'archived' } }).exec();
    const now = data<AdministrationSupplierDetailDto>(await api.get(`/suppliers/${filed.id}`));
    expect(now.attachments[0]?.scanStatus).toBeNull();
  });

  it('the platform’s own file paths ask the supplier’s keys: a branch `.edit` holder is refused a write', async () => {
    const filed = await supplier();
    const ask = (permissions: Record<string, DataScope>, intent: 'read' | 'write') =>
      supplierFileAuthorizer.authorize({
        ctx: {
          userId: String(new Types.ObjectId()),
          sessionId: 's',
          branchId: world.branchAId,
          departmentId: null,
          sectionId: null,
          locale: 'ar',
          permissions,
          permissionVersion: 1,
          isPrivileged: false,
        } satisfies AuthContext,
        entityId: filed.id,
        intent,
      });
    expect(await ask({ 'administrationSupplier.view': 'branch' }, 'read')).toBe(true);
    expect(await ask({ 'administrationSupplier.edit': 'organization' }, 'write')).toBe(true);
    expect(await ask({ 'administrationSupplier.edit': 'branch' }, 'write')).toBe(false);
    expect(await ask({ 'administrationSupplier.edit': 'organization' }, 'read')).toBe(false);
    const missing = await supplierFileAuthorizer.authorize({
      ctx: {
        userId: String(new Types.ObjectId()),
        sessionId: 's',
        branchId: null,
        departmentId: null,
        sectionId: null,
        locale: 'ar',
        permissions: { 'administrationSupplier.view': 'organization' },
        permissionVersion: 1,
        isPrivileged: false,
      },
      entityId: String(new Types.ObjectId()),
      intent: 'read',
    });
    expect(missing).toBe(false);
  });
});
