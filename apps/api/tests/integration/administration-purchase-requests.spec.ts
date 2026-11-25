// Administrative Affairs' purchase requests over real HTTP, real RBAC and a real database (P2 plan
// §12.2), one file grown by each slice of P2 (RK-01). P2.2: drafts — the register, the record, the
// create and a draft's edit, the item reads opened to the picker, and the item's unit lock.
//
// What a mocked spec cannot see: the requester read from HR through the directory's self lookup and
// held to OD-16 A's placement rules; the request filed on that employee's department copy, under
// the top bar's choice; a draft that only its requester edits, in draft, at its version, in P2 plan
// §4.2's order; scope by real grants — a department copy, a branch, `own`, a `section` grant that
// must fail closed, an approve key alone — and the register's filters and sorts on stored rows,
// Cairo days included; the item picker opened to a requester with no item key; and an item edit
// refused once a request's line names the item.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import {
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type AdministrationItemDto,
  type AdministrationPurchaseRequestDetailDto,
  type AdministrationPurchaseRequestDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { rbacService } from '../../src/platform/rbac';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { AdministrationItemModel } from '../../src/modules/administration/catalog/items/item.model';
import { AdministrationPurchaseRequestModel } from '../../src/modules/administration/procurement/purchase-requests/purchase-request.model';
import { AdministrationCounterModel } from '../../src/modules/administration/shared/counter.model';
import { documentNumberAt } from '../../src/modules/administration/shared/document-number';
import {
  administrationApi,
  bootAdministration,
  data,
  plantEmployee,
  refusal,
  stopAdministration,
  type AdministrationWorld,
  type Placement,
} from './helpers/administration-fixtures';

const VIEW = 'administrationPurchaseRequest.view';
const CREATE = 'administrationPurchaseRequest.create';
const EDIT = 'administrationPurchaseRequest.edit';
const APPROVE = 'administrationPurchaseRequest.approve';
/** The department requester bundle's keys (P2 plan §9.3). */
const REQUESTER_KEYS = [VIEW, CREATE, EDIT];

let world: AdministrationWorld;
/** Branch A's two department copies — one linked to a company department, one not — and B's. */
let deptA1: string;
let deptA2: string;
let deptB: string;
/** An item at work, a second one, one retired, and one a request names before its unit changes. */
let paper: AdministrationItemDto;
let pens: AdministrationItemDto;
let retired: AdministrationItemDto;
let unitA: AdministrationCatalogItemDto;
let unitB: AdministrationCatalogItemDto;
let category: AdministrationItemCategoryDto;

interface Requester {
  id: string;
  email: string;
  token: string;
  employeeId: string;
}
/** A1's focal point and a colleague of the same copy; A2's focal point; B's. */
let focal: Requester;
let colleague: Requester;
let focalA2: Requester;
let focalB: Requester;

const as = (token: string, activeBranchId?: string) =>
  administrationApi(world.app, token, activeBranchId);

let serial = 0;
/**
 * Someone signed in with `keys` at `scope`, placed at `placement`, and — unless `employee` is
 * null — an employee HR places at `employee`'s branch and copy, linked to that login.
 */
const requester = async (
  who: string,
  scope: 'department' | 'branch' | 'organization' | 'own' | 'section',
  placement: Placement,
  employee: { branchId: string; departmentId: string; status?: 'active' | 'exited' } | null = {
    branchId: placement.branchId ?? '',
    departmentId: placement.departmentId ?? '',
  },
  keys: string[] = REQUESTER_KEYS,
): Promise<Requester> => {
  const signed = await world.person(`pr-${who}`, keys, scope, placement);
  serial += 1;
  const employeeId =
    employee === null
      ? ''
      : await plantEmployee(
          `PRQ-${String(serial).padStart(3, '0')}`,
          `موظف ${who}`,
          employee.branchId,
          employee.departmentId,
          employee.status ?? 'active',
          signed.id,
        );
  return { ...signed, employeeId };
};

const line = (item: AdministrationItemDto, qty = 2, notes?: string) => ({
  itemId: item.id,
  qty,
  ...(notes === undefined ? {} : { notes }),
});

const draft = async (
  who: Requester,
  body: Record<string, unknown> = { lines: [line(paper)] },
): Promise<AdministrationPurchaseRequestDetailDto> => {
  const res = await as(who.token).post('/purchase-requests', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AdministrationPurchaseRequestDetailDto>(res);
};

/** An item of its own for a case that changes or removes it, so no other case sees it move. */
const freshItem = async (ar: string, en: string): Promise<AdministrationItemDto> => {
  const res = await as(world.adminToken).post('/items', {
    name: { ar, en },
    categoryId: category.id,
    unitId: unitA.id,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AdministrationItemDto>(res);
};

/** Puts a request where a later slice's act would, written straight to the collection. */
const plant = async (id: string, set: Record<string, unknown>): Promise<void> => {
  await AdministrationPurchaseRequestModel.collection.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: set },
  );
};

/** The ids a register read returns — every page a case needs is one page here. */
const listed = async (token: string, query = '', activeBranchId?: string): Promise<string[]> => {
  const res = await as(token, activeBranchId).get(`/purchase-requests?pageSize=100${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AdministrationPurchaseRequestDto[]>(res).map((row) => row.id);
};

const trail = (entityId: string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'administration',
    'entityRef.entityType': 'purchaseRequest',
    'entityRef.entityId': entityId,
  })
    .sort({ _id: 1 })
    .lean()
    .exec();

const refused = (
  res: Awaited<ReturnType<ReturnType<typeof as>['get']>>,
  status: number,
  code: string,
  details?: string[],
) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(refusal(res).code).toBe(code);
  if (details !== undefined) {
    expect(refusal(res).details?.map((detail) => `${detail.field ?? ''}:${detail.code}`)).toEqual(
      details,
    );
  }
};

beforeAll(async () => {
  world = await bootAdministration('purchase-requests');
  const admin = (path: string, body: Record<string, unknown>) =>
    administrationApi(world.app, world.adminToken).post(path, body);
  // The platform's organization routes, as the super-admin writes them.
  const org = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await request(world.app)
      .post(`/api/v1/platform${path}`)
      .set('Authorization', `Bearer ${world.adminToken}`)
      .send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  const catalogId = await org('/department-catalog', {
    code: 'ADM-PRQ',
    name: { ar: 'الشئون الإدارية', en: 'Administrative Affairs' },
  });
  deptA1 = await org('/departments', { code: 'PRQ-A1', branchId: world.branchAId, catalogId });
  deptA2 = await org('/departments', {
    code: 'PRQ-A2',
    branchId: world.branchAId,
    name: { ar: 'الصيانة', en: 'Maintenance' },
  });
  deptB = await org('/departments', { code: 'PRQ-B', branchId: world.branchBId, catalogId });

  const units = async (ar: string, en: string) => {
    const res = await admin('/catalog-items', { kind: 'unit', name: { ar, en } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return data<AdministrationCatalogItemDto>(res);
  };
  unitA = await units('رزمة', 'Ream');
  unitB = await units('علبة', 'Box');
  const cat = await admin('/item-categories', { name: { ar: 'قرطاسية', en: 'Stationery' } });
  expect(cat.status, JSON.stringify(cat.body)).toBe(201);
  category = data<AdministrationItemCategoryDto>(cat);
  const item = async (ar: string, en: string) => {
    const res = await admin('/items', {
      name: { ar, en },
      categoryId: category.id,
      unitId: unitA.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return data<AdministrationItemDto>(res);
  };
  paper = await item('ورق تصوير', 'Copy paper');
  pens = await item('أقلام جاف', 'Ballpoint pens');
  retired = await item('ورق كربون', 'Carbon paper');
  const retiring = await as(world.adminToken).patch(`/items/${retired.id}`, {
    isActive: false,
    version: retired.version,
  });
  expect(retiring.status, JSON.stringify(retiring.body)).toBe(200);

  focal = await requester('focal', 'department', {
    branchId: world.branchAId,
    departmentId: deptA1,
  });
  colleague = await requester('colleague', 'department', {
    branchId: world.branchAId,
    departmentId: deptA1,
  });
  focalA2 = await requester('focal-a2', 'department', {
    branchId: world.branchAId,
    departmentId: deptA2,
  });
  focalB = await requester('focal-b', 'department', {
    branchId: world.branchBId,
    departmentId: deptB,
  });
}, 240_000);

afterAll(async () => {
  await stopAdministration();
});

describe('the seed (P2 plan §6.3)', () => {
  it('ensures this Cairo year’s purchase-request series at boot, at its floor', async () => {
    const { series } = documentNumberAt('purchaseRequest', new Date());
    const counter = await AdministrationCounterModel.findOne({ key: series.key }).lean().exec();
    expect(counter, series.key).not.toBeNull();
  });
});

describe('a focal point’s draft (OD-16 A; P2 plan §4.2)', () => {
  it('creates a draft on their department copy, its snapshots written by the server', async () => {
    const created = await draft(focal, {
      neededBy: '2026-12-15',
      justification: 'مستلزمات الربع الأول',
      lines: [line(paper, 5, 'للطابعة الرئيسية'), line(pens, 12)],
    });
    expect(created).toMatchObject({
      number: null,
      status: 'draft',
      orderStatus: 'notOrdered',
      branchId: world.branchAId,
      branchName: { ar: 'فرع أ', en: 'Branch A' },
      departmentId: deptA1,
      departmentName: { ar: 'الشئون الإدارية', en: 'Administrative Affairs' },
      requesterUserId: focal.id,
      requesterName: 'موظف focal',
      neededBy: '2026-12-15',
      justification: 'مستلزمات الربع الأول',
      notes: null,
      lineCount: 2,
      submittedAt: null,
      businessDate: null,
      approvalRounds: [],
      version: 0,
      requester: {
        // A planted employee's job title names no row, so the snapshot has none (P2 plan §12.2).
        jobTitle: null,
        departmentId: deptA1,
        departmentName: { ar: 'الشئون الإدارية', en: 'Administrative Affairs' },
      },
    });
    expect(created.requester.employeeCode).toMatch(/^PRQ-/);
    // Design §2.1's PersonSnap and nothing of HR's beyond it: no employee id (P2 plan §6.5).
    expect(Object.keys(created.requester).sort()).toEqual([
      'departmentId',
      'departmentName',
      'employeeCode',
      'jobTitle',
    ]);
    // The unit is the item's, never the client's (OD-07), and each line copies its item.
    expect(created.lines).toEqual([
      expect.objectContaining({
        itemId: paper.id,
        itemCode: paper.code,
        itemName: paper.name,
        unitId: unitA.id,
        unitName: unitA.name,
        qty: 5,
        orderedQty: 0,
        cancelledQty: 0,
        notes: 'للطابعة الرئيسية',
      }),
      expect.objectContaining({ itemId: pens.id, qty: 12, notes: null }),
    ]);
    expect(created.availableActions).toEqual([
      { key: 'edit', permission: EDIT, enabled: true, reason: null },
      { key: 'submit', permission: CREATE, enabled: true, reason: null },
      { key: 'withdraw', permission: VIEW, enabled: true, reason: null },
    ]);

    const read = data<AdministrationPurchaseRequestDetailDto>(
      await as(focal.token).get(`/purchase-requests/${created.id}`),
    );
    expect(read).toEqual(created);

    const [row] = await trail(created.id);
    expect(row?.action).toBe('create');
    expect(row?.changes).toContainEqual({
      field: 'lines',
      old: null,
      new: [
        { itemCode: paper.code, qty: 5, notes: 'للطابعة الرئيسية' },
        { itemCode: pens.code, qty: 12, notes: null },
      ],
    });
    // The trail copies no person's name: HR's permanent delete never rewrites it.
    expect(JSON.stringify(row)).not.toContain('موظف focal');
  });

  it('edits its draft: a kept line keeps its id, a new line is added, a left-out one goes', async () => {
    const created = await draft(focal, { lines: [line(paper, 3), line(pens, 1)] });
    const [kept, dropped] = created.lines;
    const res = await as(focal.token).patch(`/purchase-requests/${created.id}`, {
      notes: 'تسليم المخزن الرئيسي',
      lines: [{ lineId: kept?.lineId, itemId: paper.id, qty: 4 }, line(pens, 6)],
      version: 0,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const edited = data<AdministrationPurchaseRequestDetailDto>(res);
    expect(edited.version).toBe(1);
    expect(edited.notes).toBe('تسليم المخزن الرئيسي');
    expect(edited.lines.map((l) => [l.itemId, l.qty])).toEqual([
      [paper.id, 4],
      [pens.id, 6],
    ]);
    expect(edited.lines[0]?.lineId).toBe(kept?.lineId);
    expect(edited.lines.map((l) => l.lineId)).not.toContain(dropped?.lineId);
    const rows = await trail(created.id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'update']);

    // A save that changes nothing the trail compares writes no row.
    const again = await as(focal.token).patch(`/purchase-requests/${created.id}`, { version: 1 });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await trail(created.id)).map((row) => row.action)).toEqual(['create', 'update']);
  });

  it('a null clears a text, and lines left out are kept', async () => {
    const created = await draft(focal, {
      neededBy: '2027-01-10',
      justification: 'سبب',
      lines: [line(paper)],
    });
    const res = await as(focal.token).patch(`/purchase-requests/${created.id}`, {
      neededBy: null,
      justification: null,
      version: 0,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const edited = data<AdministrationPurchaseRequestDetailDto>(res);
    expect(edited).toMatchObject({ neededBy: null, justification: null, lineCount: 1 });
    expect(edited.lines[0]?.lineId).toBe(created.lines[0]?.lineId);
  });

  describe('a draft’s save rewrites its snapshots (P2 plan §6.1)', () => {
    it('from live data: the item’s new name and the requester’s, and no trail row for either', async () => {
      const renamed = await requester('renamed', 'department', {
        branchId: world.branchAId,
        departmentId: deptA1,
      });
      const toner = await freshItem('حبر طابعة', 'Printer toner');
      const created = await draft(renamed, { lines: [line(toner, 2)] });
      expect(created.requesterName).toBe('موظف renamed');
      const itemRenamed = await as(world.adminToken).patch(`/items/${toner.id}`, {
        name: { ar: 'حبر طابعة ليزر', en: 'Laser printer toner' },
        version: toner.version,
      });
      expect(itemRenamed.status, JSON.stringify(itemRenamed.body)).toBe(200);
      await EmployeeModel.collection.updateOne(
        { _id: new Types.ObjectId(renamed.employeeId) },
        { $set: { 'personal.fullNameAr': 'اسم جديد للموظف' } },
      );

      const res = await as(renamed.token).patch(`/purchase-requests/${created.id}`, {
        version: 0,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const saved = data<AdministrationPurchaseRequestDetailDto>(res);
      expect(saved.requesterName).toBe('اسم جديد للموظف');
      expect(saved.lines[0]?.itemName).toEqual({ ar: 'حبر طابعة ليزر', en: 'Laser printer toner' });
      // The trail compares ids, never names (design §10.1).
      expect((await trail(created.id)).map((row) => row.action)).toEqual(['create']);
    });

    it('a requester whose HR record lost its department still saves; the copy stays the filing one', async () => {
      const unplacedLater = await requester('unplaced-later', 'department', {
        branchId: world.branchAId,
        departmentId: deptA1,
      });
      const created = await draft(unplacedLater);
      // HR's directory then spells the missing department 'null'; the login keeps its placement.
      await EmployeeModel.collection.updateOne(
        { _id: new Types.ObjectId(unplacedLater.employeeId) },
        { $set: { departmentId: null, 'employment.departmentId': null } },
      );
      const res = await as(unplacedLater.token).patch(`/purchase-requests/${created.id}`, {
        notes: 'بعد النقل',
        version: 0,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(data<AdministrationPurchaseRequestDetailDto>(res)).toMatchObject({
        notes: 'بعد النقل',
        departmentId: deptA1,
        departmentName: { ar: 'الشئون الإدارية', en: 'Administrative Affairs' },
        requester: {
          departmentId: deptA1,
          departmentName: { ar: 'الشئون الإدارية', en: 'Administrative Affairs' },
        },
      });
    });

    it('a requester HR moved to another copy, who still edits through a branch grant: the department named stays the filing copy’s', async () => {
      const mover = await requester('mover', 'branch', {
        branchId: world.branchAId,
        departmentId: deptA1,
      });
      const created = await draft(mover);
      await EmployeeModel.collection.updateOne(
        { _id: new Types.ObjectId(mover.employeeId) },
        {
          $set: {
            departmentId: new Types.ObjectId(deptA2),
            'employment.departmentId': new Types.ObjectId(deptA2),
          },
        },
      );
      const res = await as(mover.token).patch(`/purchase-requests/${created.id}`, {
        notes: 'بعد النقل',
        version: 0,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const saved = data<AdministrationPurchaseRequestDetailDto>(res);
      expect(saved).toMatchObject({
        branchId: world.branchAId,
        departmentId: deptA1,
        departmentName: { ar: 'الشئون الإدارية', en: 'Administrative Affairs' },
        requester: {
          departmentId: deptA1,
          departmentName: { ar: 'الشئون الإدارية', en: 'Administrative Affairs' },
        },
      });
      const [row] = data<AdministrationPurchaseRequestDto[]>(
        await as(mover.token).get(`/purchase-requests?requesterUserId=${mover.id}`),
      );
      expect(row).toMatchObject({
        departmentId: deptA1,
        departmentName: { ar: 'الشئون الإدارية', en: 'Administrative Affairs' },
      });
    });
  });

  describe('who may raise one (P2 plan §4.4)', () => {
    it('a login that names no employee: 422 TRANSITION_BLOCKED, requester · noEmployee', async () => {
      const nobody = await requester(
        'no-employee',
        'department',
        { branchId: world.branchAId, departmentId: deptA1 },
        null,
      );
      refused(
        await as(nobody.token).post('/purchase-requests', { lines: [] }),
        422,
        'ADMINISTRATION_TRANSITION_BLOCKED',
        ['requester:noEmployee'],
      );
    });

    it('an employee with no department: 422 TRANSITION_BLOCKED, requester · unplaced', async () => {
      const unplaced = await requester('unplaced', 'department', {
        branchId: world.branchAId,
        departmentId: deptA1,
      });
      await EmployeeModel.collection.updateOne(
        { _id: new Types.ObjectId(unplaced.employeeId) },
        { $set: { departmentId: null, 'employment.departmentId': null } },
      );
      refused(
        await as(unplaced.token).post('/purchase-requests', { lines: [] }),
        422,
        'ADMINISTRATION_TRANSITION_BLOCKED',
        ['requester:unplaced'],
      );
    });

    it('an employee who has left: 422 ADMINISTRATION_EMPLOYEE_EXITED, requester · exited', async () => {
      const leaver = await requester(
        'leaver',
        'department',
        { branchId: world.branchAId, departmentId: deptA1 },
        { branchId: world.branchAId, departmentId: deptA1, status: 'exited' },
      );
      refused(
        await as(leaver.token).post('/purchase-requests', { lines: [] }),
        422,
        'ADMINISTRATION_EMPLOYEE_EXITED',
        ['requester:exited'],
      );
    });

    it('an employee whose branch is not their copy’s: 422, requester · placementMismatch', async () => {
      const astray = await requester(
        'astray',
        'department',
        { branchId: world.branchAId, departmentId: deptA1 },
        { branchId: world.branchBId, departmentId: deptA1 },
      );
      refused(
        await as(astray.token).post('/purchase-requests', { lines: [] }),
        422,
        'ADMINISTRATION_TRANSITION_BLOCKED',
        ['requester:placementMismatch'],
      );
    });

    it('a narrowed organization holder whose top bar excludes their branch: 400 OUT_OF_REACH', async () => {
      const wide = await requester('org-wide', 'organization', {
        branchId: world.branchAId,
        departmentId: deptA1,
      });
      refused(
        await as(wide.token, world.branchBId).post('/purchase-requests', { lines: [] }),
        400,
        'VALIDATION_FAILED',
        ['branchId:OUT_OF_REACH'],
      );
      // The whole company, or the request's own branch, files it on the requester's copy.
      const filed = data<AdministrationPurchaseRequestDetailDto>(
        await as(wide.token, world.branchAId).post('/purchase-requests', { lines: [] }),
      );
      expect(filed).toMatchObject({ branchId: world.branchAId, departmentId: deptA1 });
    });

    it('a create key over another copy only: 403', async () => {
      const elsewhere = await requester(
        'elsewhere',
        'department',
        { branchId: world.branchAId, departmentId: deptA2 },
        { branchId: world.branchAId, departmentId: deptA1 },
      );
      refused(
        await as(elsewhere.token).post('/purchase-requests', { lines: [] }),
        403,
        'FORBIDDEN',
      );
    });
  });

  describe('its lines', () => {
    it('a retired item is refused on a new line, and kept on a kept line (OD-70 A)', async () => {
      refused(
        await as(focal.token).post('/purchase-requests', { lines: [line(paper), line(retired)] }),
        422,
        'ADMINISTRATION_REFERENCE_INACTIVE',
        ['lines.1.itemId:inactive'],
      );
      // A line written while its item was active keeps it after the item retires.
      const created = await draft(focal, { lines: [line(pens, 1)] });
      const keptLine = created.lines[0];
      const itemRow = data<AdministrationItemDto>(
        await as(world.adminToken).get(`/items/${pens.id}`),
      );
      const retiring = await as(world.adminToken).patch(`/items/${pens.id}`, {
        isActive: false,
        version: itemRow.version,
      });
      expect(retiring.status, JSON.stringify(retiring.body)).toBe(200);
      try {
        const kept = await as(focal.token).patch(`/purchase-requests/${created.id}`, {
          lines: [{ lineId: keptLine?.lineId, itemId: pens.id, qty: 2 }],
          version: 0,
        });
        expect(kept.status, JSON.stringify(kept.body)).toBe(200);
        // The same item on a new line is a new reference.
        refused(
          await as(focal.token).patch(`/purchase-requests/${created.id}`, {
            lines: [line(pens, 1)],
            version: 1,
          }),
          422,
          'ADMINISTRATION_REFERENCE_INACTIVE',
          ['lines.0.itemId:inactive'],
        );
      } finally {
        const now = data<AdministrationItemDto>(
          await as(world.adminToken).get(`/items/${pens.id}`),
        );
        await as(world.adminToken).patch(`/items/${pens.id}`, {
          isActive: true,
          version: now.version,
        });
      }
    });

    it('a kept line switched to a retired item is a new reference: 422 REFERENCE_INACTIVE', async () => {
      const created = await draft(focal, { lines: [line(paper, 1)] });
      refused(
        await as(focal.token).patch(`/purchase-requests/${created.id}`, {
          lines: [{ lineId: created.lines[0]?.lineId, itemId: retired.id, qty: 1 }],
          version: 0,
        }),
        422,
        'ADMINISTRATION_REFERENCE_INACTIVE',
        ['lines.0.itemId:inactive'],
      );
    });

    it('a kept line whose item no longer resolves keeps its copy, and still takes the edit', async () => {
      const gone = await freshItem('ورق مقوى', 'Cardboard');
      const created = await draft(focal, { lines: [line(gone, 1, 'قبل')] });
      // No route removes an item; an operator's hand fix is what leaves a line naming nothing.
      await AdministrationItemModel.collection.deleteOne({ _id: new Types.ObjectId(gone.id) });
      const res = await as(focal.token).patch(`/purchase-requests/${created.id}`, {
        lines: [{ lineId: created.lines[0]?.lineId, itemId: gone.id, qty: 9, notes: 'بعد' }],
        version: 0,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(data<AdministrationPurchaseRequestDetailDto>(res).lines).toEqual([
        expect.objectContaining({
          lineId: created.lines[0]?.lineId,
          itemId: gone.id,
          itemName: { ar: 'ورق مقوى', en: 'Cardboard' },
          qty: 9,
          notes: 'بعد',
        }),
      ]);
      // A new line naming it is a 404.
      const res404 = await as(focal.token).patch(`/purchase-requests/${created.id}`, {
        lines: [line(gone, 1)],
        version: 1,
      });
      expect(res404.status, JSON.stringify(res404.body)).toBe(404);
    });

    it('a line id the request does not have: 422 TRANSITION_BLOCKED, unknownLine', async () => {
      const created = await draft(focal);
      const other = await draft(focal);
      refused(
        await as(focal.token).patch(`/purchase-requests/${created.id}`, {
          lines: [line(paper), { lineId: other.lines[0]?.lineId, itemId: paper.id, qty: 1 }],
          version: 0,
        }),
        422,
        'ADMINISTRATION_TRANSITION_BLOCKED',
        ['lines.1.lineId:unknownLine'],
      );
    });

    it('an item that does not exist: 404', async () => {
      const res = await as(focal.token).post('/purchase-requests', {
        lines: [line(paper), { itemId: String(new Types.ObjectId()), qty: 1 }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(refusal(res).code).toBe('NOT_FOUND');
    });
  });

  describe('the order of an edit’s checks (P2 plan §4.2)', () => {
    it('a stale edit is 409 STALE_DOCUMENT', async () => {
      const created = await draft(focal);
      refused(
        await as(focal.token).patch(`/purchase-requests/${created.id}`, { notes: 'x', version: 3 }),
        409,
        'STALE_DOCUMENT',
      );
    });

    it('an edit of a submitted request is 422 INVALID_TRANSITION — also when its version is stale', async () => {
      const created = await draft(focal);
      await plant(created.id, { status: 'pendingApproval', number: 'PR-2026-009001', __v: 1 });
      for (const version of [1, 0]) {
        refused(
          await as(focal.token).patch(`/purchase-requests/${created.id}`, { notes: 'x', version }),
          422,
          'ADMINISTRATION_INVALID_TRANSITION',
          ['status:pendingApproval'],
        );
      }
    });

    it('a colleague’s edit of another’s draft is 403, though the colleague reads it', async () => {
      const created = await draft(focal);
      refused(
        await as(colleague.token).patch(`/purchase-requests/${created.id}`, {
          notes: 'x',
          version: 0,
        }),
        403,
        'FORBIDDEN',
      );
      const read = data<AdministrationPurchaseRequestDetailDto>(
        await as(colleague.token).get(`/purchase-requests/${created.id}`),
      );
      expect(read.availableActions).toEqual([
        { key: 'edit', permission: EDIT, enabled: false, reason: 'notRequester' },
        { key: 'submit', permission: CREATE, enabled: false, reason: 'notRequester' },
      ]);
      // Nothing was written.
      expect(read.version).toBe(0);
    });

    it('an organization-wide edit key the top bar narrows to another branch: listed outOfReach, and the edit is 404', async () => {
      const wide = await requester(
        'org-editor',
        'branch',
        { branchId: world.branchAId, departmentId: deptA1 },
        undefined,
        [VIEW],
      );
      const role = await rbacService.createRole(
        {
          name: { en: 'PR organization editor', ar: 'محرر طلبات الشراء على مستوى الشركة' },
          permissionKeys: [CREATE, EDIT],
        },
        world.adminId,
      );
      await rbacService.ensureAssignment(wide.id, String(role._id), 'organization');
      const token = await world.login(wide.email);
      const created = await draft({ ...wide, token });
      // The whole company: the record offers the edit, and the edit saves.
      const whole = data<AdministrationPurchaseRequestDetailDto>(
        await as(token).get(`/purchase-requests/${created.id}`),
      );
      expect(whole.availableActions.find((act) => act.key === 'edit')).toMatchObject({
        enabled: true,
      });
      // Branch B in the top bar: `.view`, a home-branch grant, still reads the record; `.edit`
      // and `.create`, organization-wide, now read branch B only (ADR-028).
      const narrowed = data<AdministrationPurchaseRequestDetailDto>(
        await as(token, world.branchBId).get(`/purchase-requests/${created.id}`),
      );
      expect(narrowed.availableActions).toEqual([
        { key: 'edit', permission: EDIT, enabled: false, reason: 'outOfReach' },
        { key: 'submit', permission: CREATE, enabled: false, reason: 'outOfReach' },
        { key: 'withdraw', permission: VIEW, enabled: true, reason: null },
      ]);
      refused(
        await as(token, world.branchBId).patch(`/purchase-requests/${created.id}`, {
          notes: 'x',
          version: 0,
        }),
        404,
        'NOT_FOUND',
      );
      const saved = await as(token).patch(`/purchase-requests/${created.id}`, {
        notes: 'x',
        version: 0,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    });

    it('another copy’s request is a 404 to the edit, before anything else is said of it', async () => {
      const inB = await draft(focalB);
      refused(
        await as(focal.token).patch(`/purchase-requests/${inB.id}`, { notes: 'x', version: 9 }),
        404,
        'NOT_FOUND',
      );
    });
  });
});

describe('scope (design §7.1, §7.3; RK-15)', () => {
  let inA1: AdministrationPurchaseRequestDetailDto;
  let inA2: AdministrationPurchaseRequestDetailDto;
  let inB: AdministrationPurchaseRequestDetailDto;

  beforeAll(async () => {
    inA1 = await draft(focal);
    inA2 = await draft(focalA2);
    inB = await draft(focalB);
  });

  it('a department reader reads its copy only — not the other copy of its branch', async () => {
    const ids = await listed(focal.token);
    expect(ids).toContain(inA1.id);
    expect(ids).not.toContain(inA2.id);
    expect(ids).not.toContain(inB.id);
    refused(await as(focal.token).get(`/purchase-requests/${inA2.id}`), 404, 'NOT_FOUND');
  });

  it('a branch reader reads its branch, both copies; another branch’s request is 404', async () => {
    const reader = await world.person('pr-branch-reader', [VIEW], 'branch', {
      branchId: world.branchAId,
    });
    const ids = await listed(reader.token);
    expect(ids).toEqual(expect.arrayContaining([inA1.id, inA2.id]));
    expect(ids).not.toContain(inB.id);
    refused(await as(reader.token).get(`/purchase-requests/${inB.id}`), 404, 'NOT_FOUND');
  });

  it('`own` reads what the holder raised, and nothing else', async () => {
    const own = await requester(
      'own',
      'own',
      { branchId: world.branchAId, departmentId: deptA1 },
      undefined,
      [VIEW],
    );
    const role = await rbacService.createRole(
      { name: { en: 'PR own creator', ar: 'منشئ طلبات الشراء' }, permissionKeys: [CREATE] },
      world.adminId,
    );
    await rbacService.ensureAssignment(own.id, String(role._id), 'department');
    const token = await world.login(own.email);
    const mine = await draft({ ...own, token });
    expect(await listed(token)).toEqual([mine.id]);
    refused(await as(token).get(`/purchase-requests/${inA1.id}`), 404, 'NOT_FOUND');
  });

  it('a `section` grant reads as `own` — a request carries no section, so it fails closed', async () => {
    const section = await world.person('pr-section', [VIEW], 'section', {
      branchId: world.branchAId,
      departmentId: deptA1,
    });
    expect(await listed(section.token)).toEqual([]);
    refused(await as(section.token).get(`/purchase-requests/${inA1.id}`), 404, 'NOT_FOUND');
  });

  it('a holder of `.approve` alone reads a request’s record in their reach, and no register', async () => {
    const approver = await world.person('pr-approver', [APPROVE], 'department', {
      branchId: world.branchAId,
      departmentId: deptA1,
    });
    const read = await as(approver.token).get(`/purchase-requests/${inA1.id}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    // Nothing to decide on a draft: no act is listed for them.
    expect(data<AdministrationPurchaseRequestDetailDto>(read).availableActions).toEqual([]);
    refused(await as(approver.token).get(`/purchase-requests/${inA2.id}`), 404, 'NOT_FOUND');
    refused(await as(approver.token).get('/purchase-requests'), 403, 'FORBIDDEN');
  });

  it('a key of another module reads nothing and writes nothing: 403', async () => {
    const outsider = as(world.outsiderToken);
    for (const res of [
      await outsider.get('/purchase-requests'),
      await outsider.get(`/purchase-requests/${inA1.id}`),
      await outsider.post('/purchase-requests', { lines: [] }),
      await outsider.patch(`/purchase-requests/${inA1.id}`, { notes: 'x', version: 0 }),
    ]) {
      refused(res, 403, 'FORBIDDEN');
    }
  });
});

describe('the register’s filters and sorts (P2 plan §4.1)', () => {
  let sorter: Requester;
  /** Three requests of one requester, planted where later acts would leave them. */
  let first: string;
  let second: string;
  let third: string;
  let reader: string;

  beforeAll(async () => {
    sorter = await requester('sorter', 'department', {
      branchId: world.branchAId,
      departmentId: deptA2,
    });
    first = (await draft(sorter)).id;
    second = (await draft(sorter)).id;
    third = (await draft(sorter)).id;
    await plant(first, {
      status: 'pendingApproval',
      number: 'PR-2026-000103',
      createdAt: new Date('2026-03-10T21:30:00.000Z'), // 23:30 on 10 March, Cairo time
      submittedAt: new Date('2026-03-12T08:00:00.000Z'),
      neededBy: new Date('2026-04-01T00:00:00.000Z'),
    });
    await plant(second, {
      status: 'approved',
      number: 'PR-2026-000101',
      createdAt: new Date('2026-03-11T08:00:00.000Z'),
      submittedAt: new Date('2026-03-11T09:00:00.000Z'),
      neededBy: new Date('2026-05-01T00:00:00.000Z'),
    });
    await plant(third, {
      createdAt: new Date('2026-03-09T08:00:00.000Z'),
      neededBy: new Date('2026-03-20T00:00:00.000Z'),
    });
    reader = (
      await world.person('pr-filter-reader', [VIEW], 'branch', { branchId: world.branchAId })
    ).token;
  });

  const mine = () => `&requesterUserId=${sorter.id}`;

  it('narrows to the requester asked for', async () => {
    expect((await listed(reader, mine())).sort()).toEqual([first, second, third].sort());
  });

  it('takes two statuses at once', async () => {
    expect((await listed(reader, `${mine()}&status=pendingApproval,approved`)).sort()).toEqual(
      [first, second].sort(),
    );
    expect(await listed(reader, `${mine()}&status=draft`)).toEqual([third]);
  });

  it('narrows to the copies asked for; a copy outside the reach adds no row', async () => {
    const inB = await draft(focalB);
    const ids = await listed(reader, `&departmentIds=${deptA2},${deptB}`);
    expect(ids).toEqual(expect.arrayContaining([first, second, third]));
    expect(ids).not.toContain(inB.id);
    expect(await listed(reader, `&departmentIds=${deptB}`)).toEqual([]);
  });

  it('bounds created by Cairo days: 23:30 in Cairo counts on its own day', async () => {
    expect(await listed(reader, `${mine()}&from=2026-03-10&to=2026-03-10`)).toEqual([first]);
    expect(await listed(reader, `${mine()}&to=2026-03-09`)).toEqual([third]);
    expect(await listed(reader, `${mine()}&from=2026-03-11`)).toEqual([second]);
  });

  it('searches a number from its first character, without regard to case', async () => {
    expect((await listed(reader, `${mine()}&search=pr-2026-0001`)).sort()).toEqual(
      [first, second].sort(),
    );
    expect(await listed(reader, `${mine()}&search=PR-2026-000103`)).toEqual([first]);
    expect(await listed(reader, `${mine()}&search=2026-0001`)).toEqual([]);
  });

  it.each([
    ['createdAt', 'asc', () => [third, first, second]],
    ['createdAt', 'desc', () => [second, first, third]],
    ['neededBy', 'asc', () => [third, first, second]],
    ['neededBy', 'desc', () => [second, first, third]],
    // A draft has no number and no submission; Mongo orders a null first ascending.
    ['number', 'asc', () => [third, second, first]],
    ['number', 'desc', () => [first, second, third]],
    ['submittedAt', 'asc', () => [third, second, first]],
    ['submittedAt', 'desc', () => [first, second, third]],
  ])('sorts by %s %s', async (sortBy, sortDir, expected) => {
    expect(await listed(reader, `${mine()}&sortBy=${sortBy}&sortDir=${sortDir}`)).toEqual(
      expected(),
    );
  });

  it('by default, newest created first', async () => {
    expect(await listed(reader, mine())).toEqual([second, first, third]);
  });
});

describe('the item picker and the unit lock (P2 plan §4.1, §6.2)', () => {
  it('a requester with no item key reads the items — the picker — and writes none', async () => {
    const list = await as(focal.token).get('/items?isActive=true&search=ورق');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(data<AdministrationItemDto[]>(list).map((row) => row.id)).toContain(paper.id);
    const one = await as(focal.token).get(`/items/${retired.id}`);
    expect(one.status, 'a retired item still resolves by id').toBe(200);
    refused(
      await as(focal.token).post('/items', {
        name: { ar: 'صنف', en: 'Item' },
        categoryId: category.id,
        unitId: unitA.id,
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('once a request’s line names an item, its unit change is refused — and only that', async () => {
    const res = await as(world.adminToken).post('/items', {
      name: { ar: 'دبابيس', en: 'Staples' },
      categoryId: category.id,
      unitId: unitA.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const staples = data<AdministrationItemDto>(res);
    // Unnamed, the unit changes freely, and back.
    const changed = await as(world.adminToken).patch(`/items/${staples.id}`, {
      unitId: unitB.id,
      version: staples.version,
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const back = await as(world.adminToken).patch(`/items/${staples.id}`, {
      unitId: unitA.id,
      version: staples.version + 1,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);

    await draft(focal, { lines: [line(data<AdministrationItemDto>(back))] });
    const version = staples.version + 2;
    refused(
      await as(world.adminToken).patch(`/items/${staples.id}`, { unitId: unitB.id, version }),
      422,
      'ADMINISTRATION_ITEM_UNIT_LOCKED',
      ['unitId:purchaseRequestLine'],
    );
    const other = await as(world.adminToken).patch(`/items/${staples.id}`, {
      notes: 'علب من ٥٠٠',
      version,
    });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
  });

  it('a cancelled draft that never took a number locks nothing; a numbered cancelled one does', async () => {
    const abandoned = await freshItem('مشابك ورق', 'Paper clips');
    await plant((await draft(focal, { lines: [line(abandoned)] })).id, { status: 'cancelled' });
    const free = await as(world.adminToken).patch(`/items/${abandoned.id}`, {
      unitId: unitB.id,
      version: abandoned.version,
    });
    expect(free.status, JSON.stringify(free.body)).toBe(200);

    const decided = await freshItem('أظرف', 'Envelopes');
    await plant((await draft(focal, { lines: [line(decided)] })).id, {
      status: 'cancelled',
      number: 'PR-2026-009777',
    });
    refused(
      await as(world.adminToken).patch(`/items/${decided.id}`, {
        unitId: unitB.id,
        version: decided.version,
      }),
      422,
      'ADMINISTRATION_ITEM_UNIT_LOCKED',
      ['unitId:purchaseRequestLine'],
    );
  });
});
