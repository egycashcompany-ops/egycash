// «مصروفات التراخيص» against a real mongo — a renewal, an extension, or both in one record; nothing
// in a half is required; a hand-typed plate keeps no car; an edit is versioned; a delete is soft;
// and the set-up's signatures start from the department's own names. Its items: which memo and
// which group («طريقة الصرف») offer each, and deleting one the owner added («امسح بند انا ضيفته»).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  CreateFleetCatalogItemSchema,
  CreateFleetCustodySettlementSchema,
  CreateFleetLicenseExpenseSchema,
  FleetLicenseExpenseSummaryQuerySchema,
  ListFleetLicenseExpensesQuerySchema,
  UpdateFleetCatalogItemSchema,
  type FleetCatalogItemDto,
  type FleetLicenseExpenseDto,
  type FleetLicenseExpenseTemplateLine,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { buildApp } from '../../src/app';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetLicenseExpenseSettingsModel } from '../../src/modules/fleet/license-expenses/license-expense-settings.model';
import { FleetLicenseExpenseModel } from '../../src/modules/fleet/license-expenses/license-expense.model';
import {
  DEFAULT_LICENSE_EXPENSE_SIGNATURES,
  fleetLicenseExpenseService,
} from '../../src/modules/fleet/license-expenses/license-expense.service';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { fleetCatalogItemService } from '../../src/modules/fleet/catalogs/catalog-item.service';
import { toCatalogItemDto } from '../../src/modules/fleet/fleet.mappers';
import { fleetCustodyFundService } from '../../src/modules/fleet/custody/custody-fund.service';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const ACTOR = new Types.ObjectId().toString();
const SIGNATURES = { agent: 'أ', director: 'ب', generalManager: 'ج\nد' };

let app: Express;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('a licensing-expenses memo', () => {
  it('refuses a record that is neither a renewal nor an extension', () => {
    expect(
      CreateFleetLicenseExpenseSchema.safeParse({
        date: '2026-10-04',
        renewal: null,
        extension: null,
        signatures: SIGNATURES,
      }).success,
    ).toBe(false);
  });

  it('saves an empty renewal — nothing in a half is required', async () => {
    const dto = await fleetLicenseExpenseService.create(
      CreateFleetLicenseExpenseSchema.parse({
        date: '2026-10-04',
        renewal: { vehicles: [], items: [] },
        extension: null,
        signatures: SIGNATURES,
      }),
      ACTOR,
    );
    expect(dto).toMatchObject({
      date: '2026-10-04',
      renewal: { vehicles: [], items: [] },
      extension: null,
      signatures: SIGNATURES,
      version: 0,
    });
    // Not settled by «تسوية عهدة» yet: «لم تُسوَّ بعد».
    expect(dto.renewal).toEqual({ vehicles: [], items: [], settlement: null });
  });

  it('keeps both memos, every line and a hand-typed plate; edits under a version; deletes softly', async () => {
    const created = await fleetLicenseExpenseService.create(
      CreateFleetLicenseExpenseSchema.parse({
        date: '2026-09-24',
        renewal: {
          vehicles: [{ vehicleId: null, plate: 'أ ق 1761' }],
          items: [
            {
              itemId: null,
              label: 'أمان',
              amount: 600,
              count: 1,
              paidBy: 'visa',
              receipt: true,
            },
            {
              itemId: null,
              label: 'دمغة',
              amount: null,
              count: 4,
              paidBy: 'cash',
              receipt: false,
            },
          ],
        },
        extension: {
          vehicles: [{ vehicleId: null, plate: 'أ ق 1791' }],
          items: [
            {
              itemId: null,
              label: 'تصوير',
              amount: 18,
              count: 2,
              paidBy: 'cash',
              receipt: false,
            },
          ],
        },
        signatures: SIGNATURES,
      }),
      ACTOR,
    );
    expect(created.renewal?.vehicles).toEqual([{ vehicleId: null, code: null, plate: 'أ ق 1761' }]);
    expect(created.renewal?.items.map((item) => [item.label, item.amount, item.paidBy])).toEqual([
      ['أمان', 600, 'visa'],
      ['دمغة', null, 'cash'],
    ]);
    expect(created.extension?.items[0]).toMatchObject({ label: 'تصوير', count: 2 });

    const edited = await fleetLicenseExpenseService.update(
      created.id,
      {
        date: new Date('2026-09-25'),
        renewal: null,
        extension: created.extension,
        signatures: SIGNATURES,
        version: created.version,
      } as never,
      ACTOR,
    );
    expect(edited.renewal).toBeNull();
    expect(edited.date).toBe('2026-09-25');
    await expect(
      fleetLicenseExpenseService.update(
        created.id,
        { ...edited, date: new Date('2026-09-26'), version: created.version } as never,
        ACTOR,
      ),
    ).rejects.toThrow();

    const extensions = await fleetLicenseExpenseService.list(
      ListFleetLicenseExpensesQuerySchema.parse({ kind: 'extension' }),
    );
    expect(extensions.items.map((row) => row.id)).toContain(created.id);
    const renewals = await fleetLicenseExpenseService.list(
      ListFleetLicenseExpensesQuerySchema.parse({ kind: 'renewal' }),
    );
    expect(renewals.items.map((row) => row.id)).not.toContain(created.id);

    await fleetLicenseExpenseService.remove(created.id, ACTOR);
    const after = await fleetLicenseExpenseService.list(
      ListFleetLicenseExpensesQuerySchema.parse({}),
    );
    expect(after.items.map((row) => row.id)).not.toContain(created.id);
    // Soft: the row is still in the database, marked deleted.
    const raw = await FleetLicenseExpenseModel.findById(created.id).lean().exec();
    expect(raw?.isDeleted).toBe(true);
  });

  it('filters by date, both days included', async () => {
    const dto = await fleetLicenseExpenseService.create(
      CreateFleetLicenseExpenseSchema.parse({
        date: '2025-01-15',
        renewal: null,
        extension: { vehicles: [], items: [] },
        signatures: SIGNATURES,
      }),
      ACTOR,
    );
    const inside = await fleetLicenseExpenseService.list(
      ListFleetLicenseExpensesQuerySchema.parse({ from: '2025-01-15', to: '2025-01-15' }),
    );
    expect(inside.items.map((row) => row.id)).toEqual([dto.id]);
  });

  it('starts the set-up from the department names, then keeps what is saved', async () => {
    const empty = { renewal: { visa: [], cash: [] }, extension: { visa: [], cash: [] } };
    expect(await fleetLicenseExpenseService.getSettings()).toEqual({
      signatures: DEFAULT_LICENSE_EXPENSE_SIGNATURES,
      templates: empty,
      version: null,
    });
    const saved = await fleetLicenseExpenseService.saveSettings({ signatures: SIGNATURES }, ACTOR);
    expect(saved).toEqual({ signatures: SIGNATURES, templates: empty, version: 0 });
    const again = await fleetLicenseExpenseService.saveSettings(
      { signatures: { ...SIGNATURES, agent: 'هـ' }, version: 0 },
      ACTOR,
    );
    expect(again.signatures.agent).toBe('هـ');
  });

  it('keeps the four templates, and leaves them alone when a save does not name them', async () => {
    const before = await fleetLicenseExpenseService.getSettings();
    const line = { itemId: null, label: 'ضرائب', amount: 1450, count: 1, receipt: true };
    const templates = {
      renewal: { visa: [line], cash: [] },
      extension: { visa: [], cash: [{ ...line, label: 'دمغة', amount: 5, receipt: false }] },
    };
    const saved = await fleetLicenseExpenseService.saveSettings(
      { signatures: SIGNATURES, templates, version: before.version ?? 0 },
      ACTOR,
    );
    expect(saved.templates).toEqual(templates);
    const signaturesOnly = await fleetLicenseExpenseService.saveSettings(
      { signatures: SIGNATURES, version: saved.version ?? 0 },
      ACTOR,
    );
    expect(signaturesOnly.templates, 'untouched by a save without them').toEqual(templates);
  });

  it('seeds the memo items the department lists', async () => {
    const items = await FleetCatalogItemModel.find({ kind: 'licenseExpenseItem', isDeleted: false })
      .lean()
      .exec();
    expect(items.map((item) => item.name.ar)).toEqual(
      expect.arrayContaining(['براءة ذمة', 'تأمين إجباري', 'ضرائب', 'أمان', 'استمارة بيانات']),
    );
    expect(items).toHaveLength(13);
  });

  it('keeps which memo an item belongs to, both by default, and only on a memo item', async () => {
    // «هضيف البنود واحدد تبع تجديد التراخيص ولا مد المده».
    const seeded = await FleetCatalogItemModel.findOne({
      kind: 'licenseExpenseItem',
      isDeleted: false,
    })
      .lean()
      .exec();
    expect(seeded, 'a seeded item').not.toBeNull();
    // An item from before the question reads as both memos — as it always was offered.
    expect(toCatalogItemDto(seeded!).licenseExpenseKind).toBeNull();

    const renewalOnly = await fleetCatalogItemService.create(
      CreateFleetCatalogItemSchema.parse({
        kind: 'licenseExpenseItem',
        name: { ar: 'رسوم تجديد', en: 'Renewal fee' },
        licenseExpenseKind: 'renewal',
      }),
      ACTOR,
    );
    expect(toCatalogItemDto(renewalOnly).licenseExpenseKind).toBe('renewal');
    // Nothing is required: left out, the item is in both.
    const unsaid = await fleetCatalogItemService.create(
      CreateFleetCatalogItemSchema.parse({
        kind: 'licenseExpenseItem',
        name: { ar: 'رسوم أخرى', en: 'Other fee' },
      }),
      ACTOR,
    );
    expect(toCatalogItemDto(unsaid).licenseExpenseKind).toBeNull();

    const moved = await fleetCatalogItemService.update(
      String(renewalOnly._id),
      { licenseExpenseKind: 'extension', version: renewalOnly.__v },
      ACTOR,
    );
    expect(toCatalogItemDto(moved).licenseExpenseKind).toBe('extension');
    const both = await fleetCatalogItemService.update(
      String(moved._id),
      { licenseExpenseKind: null, version: moved.__v },
      ACTOR,
    );
    expect(toCatalogItemDto(both).licenseExpenseKind, 'null puts it back in both').toBeNull();

    // A memo means nothing on any other list.
    expect(
      CreateFleetCatalogItemSchema.safeParse({
        kind: 'workshop',
        name: { ar: 'ورشة', en: 'Workshop' },
        licenseExpenseKind: 'renewal',
      }).success,
    ).toBe(false);
    const workshop = await fleetCatalogItemService.create(
      CreateFleetCatalogItemSchema.parse({
        kind: 'workshop',
        name: { ar: 'ورشة ت', en: 'Workshop T' },
      }),
      ACTOR,
    );
    await expect(
      fleetCatalogItemService.update(
        String(workshop._id),
        { licenseExpenseKind: 'renewal', version: workshop.__v },
        ACTOR,
      ),
    ).rejects.toThrow(/licenseExpenseItem/u);
  });
});

describe('«طريقة الصرف» and «امسح بند انا ضيفته» — the memo items', () => {
  // «وعاوز احدد البند كمان هو صرفه بفيزا إدارة الحركة او صرفه نقدًا او كلاهما ف اعدادات النماذج او
  // امسح بند انا ضيفته».
  const PASSWORD = 'Str0ng#Pass!';
  let people = 0;
  /** A user holding exactly `permissionKeys`, with a token signed for them. */
  const personWith = async (permissionKeys: string[]): Promise<{ id: string; token: string }> => {
    people += 1;
    const role = await rbacService.createRole(
      { name: { en: `Items role ${people}`, ar: `دور البنود ${people}` }, permissionKeys },
      ACTOR,
    );
    const { user } = await userService.create(
      {
        email: `license-items-${people}@ecms.local`,
        firstName: { ar: 'ب', en: 'I' },
        lastName: { ar: 'ن', en: 'T' },
        locale: 'en',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      null,
    );
    const id = String(user._id);
    await userService.setPassword(id, PASSWORD, 'passwordReset');
    await userService.forceActivate(id);
    await rbacService.ensureAssignment(id, String(role._id), 'organization');
    return { id, token: authService.signAccessToken(id, new Types.ObjectId().toString(), 0) };
  };

  let manager: { id: string; token: string };
  /** Reads the catalogs (the licensing screens' audience), never writes one. */
  let reader: { id: string; token: string };
  beforeAll(async () => {
    manager = await personWith(['fleetCatalog.manage', 'fleetVehicle.view']);
    reader = await personWith(['fleetVehicle.view', 'fleetLicenseExpense.view']);
  });

  const body = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
  const add = async (ar: string, extra: Record<string, unknown> = {}) => {
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ kind: 'licenseExpenseItem', name: { ar, en: ar }, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return body<FleetCatalogItemDto>(res);
  };
  const remove = (token: string, id: string) =>
    request(app)
      .delete(`/api/v1/fleet/catalog-items/${id}`)
      .set('Authorization', `Bearer ${token}`);
  const listed = async (): Promise<FleetCatalogItemDto[]> => {
    const res = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'licenseExpenseItem', pageSize: 100 })
      .set('Authorization', `Bearer ${manager.token}`);
    expect(res.status).toBe(200);
    return body<FleetCatalogItemDto[]>(res);
  };
  const seededItem = async () => {
    const seeded = await FleetCatalogItemModel.findOne({
      kind: 'licenseExpenseItem',
      createdBy: null,
      isDeleted: false,
    })
      .lean()
      .exec();
    expect(seeded, 'a seeded item').not.toBeNull();
    return seeded!;
  };
  const auditOf = (entityId: string, action: string) =>
    AuditLogModel.find({
      'entityRef.moduleId': 'fleet',
      'entityRef.entityType': 'catalogItem',
      'entityRef.entityId': entityId,
      action,
    })
      .sort({ _id: 1 })
      .lean()
      .exec();

  it('reads a seeded item as both groups and built in — an item added by hand is not', async () => {
    const seeded = toCatalogItemDto(await seededItem());
    expect(seeded).toMatchObject({ licenseExpensePaidBy: null, builtIn: true });
    const added = await add('رسوم فحص فني');
    expect(added).toMatchObject({ licenseExpensePaidBy: null, builtIn: false });
  });

  it('reads an item stored before the question — no key at all — as both groups', async () => {
    const _id = new Types.ObjectId();
    await FleetCatalogItemModel.collection.insertOne({
      _id,
      kind: 'licenseExpenseItem',
      name: { ar: 'بند قديم', en: 'Old item' },
      countsForAlarm: false,
      violationSide: null,
      licenseExpenseKind: null,
      isActive: true,
      sortOrder: null,
      schemaVersion: 1,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: new Types.ObjectId(ACTOR),
      updatedBy: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      __v: 0,
    });
    const old = await FleetCatalogItemModel.findById(_id).lean().exec();
    expect(old && 'licenseExpensePaidBy' in old ? old.licenseExpensePaidBy : undefined).toBe(
      undefined,
    );
    expect(toCatalogItemDto(old!).licenseExpensePaidBy).toBeNull();
  });

  it('keeps how an item is paid — card, cash, or both again — and audits each change', async () => {
    const visa = await add('رسوم بالفيزا', { licenseExpensePaidBy: 'visa' });
    expect(visa.licenseExpensePaidBy).toBe('visa');
    const cash = await fleetCatalogItemService.update(
      visa.id,
      UpdateFleetCatalogItemSchema.parse({ licenseExpensePaidBy: 'cash', version: visa.version }),
      manager.id,
    );
    expect(toCatalogItemDto(cash).licenseExpensePaidBy).toBe('cash');
    // The other facts of the item are untouched by the payment way.
    expect(toCatalogItemDto(cash)).toMatchObject({ licenseExpenseKind: null, isActive: true });
    const both = await fleetCatalogItemService.update(
      visa.id,
      UpdateFleetCatalogItemSchema.parse({ licenseExpensePaidBy: null, version: cash.__v }),
      manager.id,
    );
    expect(toCatalogItemDto(both).licenseExpensePaidBy, 'null puts it back in both').toBeNull();
    const card = await fleetCatalogItemService.update(
      visa.id,
      UpdateFleetCatalogItemSchema.parse({ licenseExpensePaidBy: 'visa', version: both.__v }),
      manager.id,
    );
    // An edit that does not name it — a rename — leaves it alone.
    const renamed = await fleetCatalogItemService.update(
      visa.id,
      UpdateFleetCatalogItemSchema.parse({
        name: { ar: 'رسوم بالفيزا ٢', en: 'Card fee 2' },
        version: card.__v,
      }),
      manager.id,
    );
    expect(toCatalogItemDto(renamed).licenseExpensePaidBy).toBe('visa');

    const changes = (await auditOf(visa.id, 'update')).flatMap((row) =>
      (row.changes as { field: string; old: unknown; new: unknown }[]).filter(
        (change) => change.field === 'licenseExpensePaidBy',
      ),
    );
    expect(changes.map((change) => [change.old, change.new])).toEqual([
      ['visa', 'cash'],
      ['cash', null],
      [null, 'visa'],
    ]);
    // …and the creation's record names it too.
    const createdRows = await auditOf(visa.id, 'create');
    expect(
      createdRows.flatMap((row) =>
        (row.changes as { field: string; new: unknown }[])
          .filter((change) => change.field === 'licenseExpensePaidBy')
          .map((change) => change.new),
      ),
    ).toEqual(['visa']);
  });

  it('means nothing on any other list — refused on create and on edit, null allowed', async () => {
    expect(
      CreateFleetCatalogItemSchema.safeParse({
        kind: 'workshop',
        name: { ar: 'ورشة', en: 'Workshop' },
        licenseExpensePaidBy: 'cash',
      }).success,
    ).toBe(false);
    const refused = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({
        kind: 'workshop',
        name: { ar: 'ورشة الدفع', en: 'Paid shop' },
        licenseExpensePaidBy: 'visa',
      });
    expect(refused.status).toBe(400);

    const workshop = await fleetCatalogItemService.create(
      CreateFleetCatalogItemSchema.parse({
        kind: 'workshop',
        name: { ar: 'ورشة طريقة الصرف', en: 'Workshop P' },
        licenseExpensePaidBy: null,
      }),
      ACTOR,
    );
    expect(toCatalogItemDto(workshop).licenseExpensePaidBy).toBeNull();
    const edit = await request(app)
      .patch(`/api/v1/fleet/catalog-items/${String(workshop._id)}`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ licenseExpensePaidBy: 'cash', version: workshop.__v });
    expect(edit.status).toBe(409);
    expect(JSON.stringify(edit.body)).toMatch(/licenseExpenseItem/u);
    const unchanged = await FleetCatalogItemModel.findById(workshop._id).lean().exec();
    expect(unchanged?.licenseExpensePaidBy ?? null).toBeNull();
  });

  it('deletes an item the owner added — softly, out of the list, its name free again, audited', async () => {
    const item = await add('رسوم للحذف', { licenseExpensePaidBy: 'cash' });
    expect((await listed()).map((row) => row.id)).toContain(item.id);

    const res = await remove(manager.token, item.id);
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    expect((await listed()).map((row) => row.id)).not.toContain(item.id);
    // Soft: the row is still in the database, marked deleted, by whom.
    const raw = await FleetCatalogItemModel.findById(item.id).lean().exec();
    expect(raw).toMatchObject({ isDeleted: true, licenseExpensePaidBy: 'cash' });
    expect(String(raw?.deletedBy)).toBe(manager.id);
    expect(raw?.deletedAt).toBeInstanceOf(Date);

    const [audit] = await auditOf(item.id, 'delete');
    expect(audit, 'one delete record').toBeDefined();
    expect(audit?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'name',
          old: expect.objectContaining({ ar: 'رسوم للحذف' }),
        }),
        expect.objectContaining({ field: 'licenseExpensePaidBy', old: 'cash' }),
      ]),
    );

    // Gone is gone: a second delete finds nothing.
    expect((await remove(manager.token, item.id)).status).toBe(404);
    // The name is free — he may add it again, as a new item.
    const again = await add('رسوم للحذف');
    expect(again.id).not.toBe(item.id);
    expect(again.builtIn).toBe(false);
  });

  it('deletes an archived item the owner added, too', async () => {
    const item = await add('رسوم مؤرشفة');
    const archived = await fleetCatalogItemService.update(
      item.id,
      UpdateFleetCatalogItemSchema.parse({ isActive: false, version: item.version }),
      manager.id,
    );
    expect(archived.isActive).toBe(false);
    expect((await remove(manager.token, item.id)).status).toBe(204);
    expect((await FleetCatalogItemModel.findById(item.id).lean().exec())?.isDeleted).toBe(true);
  });

  it('refuses a built-in item (409) — the boot would only seed it again; it is archived', async () => {
    const seeded = await seededItem();
    const res = await remove(manager.token, String(seeded._id));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/built-in/u);
    const raw = await FleetCatalogItemModel.findById(seeded._id).lean().exec();
    expect(raw?.isDeleted).toBe(false);
    expect(await auditOf(String(seeded._id), 'delete')).toEqual([]);
  });

  it('refuses every other list (409) — a workshop is pointed at by visits; it is archived', async () => {
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ kind: 'workshop', name: { ar: 'ورشة لا تُحذف', en: 'Kept shop' } });
    expect(res.status).toBe(201);
    const workshop = body<FleetCatalogItemDto>(res);
    expect(workshop.builtIn, 'added by a person — still not deletable').toBe(false);
    const refused = await remove(manager.token, workshop.id);
    expect(refused.status).toBe(409);
    expect((await FleetCatalogItemModel.findById(workshop.id).lean().exec())?.isDeleted).toBe(
      false,
    );
  });

  it('demands fleetCatalog.manage (403), a real id (400), and a live item (404)', async () => {
    const item = await add('رسوم محمية');
    const denied = await remove(reader.token, item.id);
    expect(denied.status).toBe(403);
    expect((await FleetCatalogItemModel.findById(item.id).lean().exec())?.isDeleted).toBe(false);
    expect((await remove(manager.token, 'not-an-id')).status).toBe(400);
    expect((await remove(manager.token, new Types.ObjectId().toString())).status).toBe(404);
  });

  it('leaves a saved memo that counted the item exactly as it was', async () => {
    const item = await add('رسوم في مذكرة', { licenseExpensePaidBy: 'visa' });
    const memo = await fleetLicenseExpenseService.create(
      CreateFleetLicenseExpenseSchema.parse({
        date: '2026-10-20',
        renewal: {
          vehicles: [{ vehicleId: null, plate: 'ب ن 1' }],
          items: [
            {
              itemId: item.id,
              label: 'رسوم في مذكرة',
              amount: 75.5,
              count: 2,
              paidBy: 'visa',
              receipt: true,
            },
          ],
        },
        extension: null,
        signatures: SIGNATURES,
      }),
      ACTOR,
    );
    expect((await remove(manager.token, item.id)).status).toBe(204);
    const read = await fleetLicenseExpenseService.get(memo.id);
    expect(read.renewal?.items).toEqual([
      {
        itemId: item.id,
        label: 'رسوم في مذكرة',
        amount: 75.5,
        count: 2,
        paidBy: 'visa',
        receipt: true,
      },
    ]);
    expect(read.version, 'the memo was not touched').toBe(memo.version);
  });

  it('drops a deleted item from the four templates as they are read — stored and versioned as before', async () => {
    const gone = await add('رسوم تُحذف من النموذج');
    const kept = await add('رسوم تبقى في النموذج');
    const archived = await add('رسوم مؤرشفة في النموذج');
    await fleetCatalogItemService.update(
      archived.id,
      UpdateFleetCatalogItemSchema.parse({ isActive: false, version: archived.version }),
      manager.id,
    );
    const line = (itemId: string | null, label: string): FleetLicenseExpenseTemplateLine => ({
      itemId,
      label,
      amount: 10,
      count: 1,
      receipt: true,
    });
    const goneLine = line(gone.id, gone.name.ar);
    const keptLine = line(kept.id, kept.name.ar);
    const archivedLine = line(archived.id, archived.name.ar);
    const handLine = line(null, 'مكتوب باليد');
    const templates = {
      renewal: { visa: [goneLine, keptLine], cash: [handLine, goneLine] },
      extension: { visa: [archivedLine], cash: [goneLine] },
    };
    const before = await fleetLicenseExpenseService.getSettings();
    const saved = await fleetLicenseExpenseService.saveSettings(
      { signatures: SIGNATURES, templates, version: before.version ?? 0 },
      ACTOR,
    );
    expect(saved.templates).toEqual(templates);

    expect((await remove(manager.token, gone.id)).status).toBe(204);

    const read = await fleetLicenseExpenseService.getSettings();
    expect(read.templates).toEqual({
      renewal: { visa: [keptLine], cash: [handLine] },
      // An archived item's line stays — archiving stops new choices, it removes nothing.
      extension: { visa: [archivedLine], cash: [] },
    });
    expect(read.version, 'the version does not move').toBe(saved.version);
    expect(read.signatures).toEqual(SIGNATURES);
    // Nothing stored changed: the lines are still there until the next «حفظ الإعداد».
    const stored = await FleetLicenseExpenseSettingsModel.findOne({ key: 'default' }).lean().exec();
    expect(stored?.templates).toEqual(templates);

    // Through the route, the set-up reads the same.
    const viaRoute = await request(app)
      .get('/api/v1/fleet/license-expenses/settings')
      .set('Authorization', `Bearer ${reader.token}`);
    expect(viaRoute.status, JSON.stringify(viaRoute.body)).toBe(200);
    expect(body<typeof read>(viaRoute).templates).toEqual(read.templates);

    // A page that read them saves without a clash — and writes the lines out for good.
    const resaved = await fleetLicenseExpenseService.saveSettings(
      { signatures: SIGNATURES, templates: read.templates, version: read.version ?? 0 },
      ACTOR,
    );
    expect(resaved.templates).toEqual(read.templates);
    const storedAfter = await FleetLicenseExpenseSettingsModel.findOne({ key: 'default' })
      .lean()
      .exec();
    expect(storedAfter?.templates).toEqual(read.templates);
  });

  it('a page opened before the delete saves the item back — its lines are written out all the same', async () => {
    // HUB: the save answers and stores the templates as a read would show them, so a set-up still
    // open from before the delete neither stores the item again nor shows it until its next read.
    const gone = await add('رسوم تُحذف قبل الحفظ');
    const line = (itemId: string | null, label: string): FleetLicenseExpenseTemplateLine => ({
      itemId,
      label,
      amount: 10,
      count: 1,
      receipt: true,
    });
    const goneLine = line(gone.id, gone.name.ar);
    const handLine = line(null, 'مكتوب باليد قبل الحذف');
    const stale = await fleetLicenseExpenseService.getSettings();
    expect((await remove(manager.token, gone.id)).status).toBe(204);

    const saved = await fleetLicenseExpenseService.saveSettings(
      {
        signatures: SIGNATURES,
        templates: {
          renewal: { visa: [goneLine, handLine], cash: [] },
          extension: { visa: [], cash: [goneLine] },
        },
        version: stale.version ?? 0,
      },
      ACTOR,
    );
    const live = { renewal: { visa: [handLine], cash: [] }, extension: { visa: [], cash: [] } };
    expect(saved.templates).toEqual(live);
    const stored = await FleetLicenseExpenseSettingsModel.findOne({ key: 'default' }).lean().exec();
    expect(stored?.templates).toEqual(live);
    expect((await fleetLicenseExpenseService.getSettings()).templates).toEqual(live);
  });
});

describe('the licensing-expenses board — its arrows and «الإحصائيات»', () => {
  type Line = { amount: number | null; count: number; paidBy: 'visa' | 'cash' };
  const half = (plates: number, lines: Line[]) => ({
    vehicles: Array.from({ length: plates }, (_, i) => ({
      vehicleId: null,
      plate: `ل ت ${i + 1}`,
    })),
    items: lines.map((line) => ({ itemId: null, label: 'بند', receipt: true, ...line })),
  });
  const write = async (
    date: string,
    renewal: ReturnType<typeof half> | null,
    extension: ReturnType<typeof half> | null,
  ): Promise<string> =>
    (
      await fleetLicenseExpenseService.create(
        CreateFleetLicenseExpenseSchema.parse({ date, renewal, extension, signatures: SIGNATURES }),
        ACTOR,
      )
    ).id;

  // A month of its own, so the memos the other cases wrote stay out of the order and the sums.
  const MONTH = { from: '2024-03-01', to: '2024-03-31' };
  let ids: { small: string; big: string; tie: string; both: string };
  beforeAll(async () => {
    ids = {
      // 100 by the card, 2 × 5 in cash — 110 in all, one car.
      small: await write(
        '2024-03-05',
        half(1, [
          { amount: 100, count: 1, paidBy: 'visa' },
          { amount: 5, count: 2, paidBy: 'cash' },
        ]),
        null,
      ),
      // 400 in all, three cars, no amount on one line (nothing).
      big: await write(
        '2024-03-02',
        null,
        half(3, [
          { amount: 200, count: 2, paidBy: 'cash' },
          { amount: null, count: 3, paidBy: 'visa' },
        ]),
      ),
      // 110 again, a later day: the tie on the total is broken by the date.
      tie: await write('2024-03-20', half(0, [{ amount: 110, count: 1, paidBy: 'visa' }]), null),
      // Both memos: 0.1 + 0.2 by the card, 2 cars.
      both: await write(
        '2024-03-10',
        half(1, [{ amount: 0.1, count: 1, paidBy: 'visa' }]),
        half(1, [{ amount: 0.2, count: 1, paidBy: 'visa' }]),
      ),
    };
  });

  const order = async (sort: string): Promise<string[]> =>
    (
      await fleetLicenseExpenseService.list(
        ListFleetLicenseExpensesQuerySchema.parse({ ...MONTH, sort }),
      )
    ).items.map((row) => row.id);

  it('orders by the grand total, then by the date — figures the memo never stores', async () => {
    expect(await order('total:desc,date:asc')).toEqual([ids.big, ids.small, ids.tie, ids.both]);
    expect(await order('total:desc,date:desc')).toEqual([ids.big, ids.tie, ids.small, ids.both]);
  });

  it('orders by the cars, each payment and the kind — renewal, both, extension', async () => {
    expect(await order('carsCount:desc,date:asc')).toEqual([ids.big, ids.both, ids.small, ids.tie]);
    expect((await order('cashTotal:desc'))[0]).toBe(ids.big);
    expect((await order('visaTotal:desc,date:asc')).slice(0, 2)).toEqual([ids.tie, ids.small]);
    expect(await order('kindOrder:asc,date:asc')).toEqual([ids.small, ids.tie, ids.both, ids.big]);
  });

  it('takes the arrows through the contract — `sort` is no longer refused', () => {
    expect(ListFleetLicenseExpensesQuerySchema.safeParse({ sort: 'total:desc' }).success).toBe(
      true,
    );
    expect(FleetLicenseExpenseSummaryQuerySchema.safeParse({ page: 2 }).success, 'no paging').toBe(
      false,
    );
  });

  it('sums the whole filtered set — every page, rounded to the piastre', async () => {
    const totals = await fleetLicenseExpenseService.summary(
      FleetLicenseExpenseSummaryQuerySchema.parse(MONTH),
    );
    // Cards: 100 + 110 + 0.1 + 0.2; cash: 10 + 400. Six cars on four memos.
    expect(totals).toEqual({ count: 4, cars: 6, visaTotal: 210.3, cashTotal: 410 });
    const withExtension = await fleetLicenseExpenseService.summary(
      FleetLicenseExpenseSummaryQuerySchema.parse({ ...MONTH, kind: 'extension' }),
    );
    expect(withExtension).toMatchObject({ count: 2, cars: 5 });
  });

  it('leaves a deleted memo out of the figures, as out of the table', async () => {
    await fleetLicenseExpenseService.remove(ids.tie, ACTOR);
    const totals = await fleetLicenseExpenseService.summary(
      FleetLicenseExpenseSummaryQuerySchema.parse(MONTH),
    );
    expect(totals).toEqual({ count: 3, cars: 6, visaTotal: 100.3, cashTotal: 410 });
  });
});

describe('the licensing-expenses board orders money as the cell prints it', () => {
  // A month of its own, apart from the arrows' cases above.
  const APRIL = { from: '2024-04-01', to: '2024-04-30' };
  const card = (amounts: number[]) => ({
    vehicles: [],
    items: amounts.map((amount) => ({
      itemId: null,
      label: 'بند',
      amount,
      count: 1,
      paidBy: 'visa' as const,
      receipt: true,
    })),
  });
  const write = async (date: string, amounts: number[]): Promise<string> =>
    (
      await fleetLicenseExpenseService.create(
        CreateFleetLicenseExpenseSchema.parse({
          date,
          renewal: card(amounts),
          extension: null,
          signatures: SIGNATURES,
        }),
        ACTOR,
      )
    ).id;

  it('ties «0.30» with «0.30», so the next arrow decides — 0.1 + 0.2 is not more', async () => {
    // Both read 0.30 on the screen; the database holds 0.30000000000000004 for the first.
    const residue = await write('2024-04-20', [0.1, 0.2]);
    const exact = await write('2024-04-02', [0.3]);
    for (const sort of ['total:desc,date:asc', 'visaTotal:desc,date:asc']) {
      const ids = (
        await fleetLicenseExpenseService.list(
          ListFleetLicenseExpensesQuerySchema.parse({ ...APRIL, sort }),
        )
      ).items.map((row) => row.id);
      expect(ids, sort).toEqual([exact, residue]);
    }
  });
});

describe('«التسوية» — a licensing memo the custody fund settled', () => {
  // A month of its own, apart from every case above.
  const JULY = { from: '2023-07-01', to: '2023-07-31' };
  const memo = (amount: number) => ({
    vehicles: [{ vehicleId: null, plate: 'ل ت 9' }],
    items: [
      { itemId: null, label: 'بند', amount, count: 1, paidBy: 'visa' as const, receipt: true },
    ],
  });
  const write = async (date: string, renewal: number | null, extension: number | null) =>
    fleetLicenseExpenseService.create(
      CreateFleetLicenseExpenseSchema.parse({
        date,
        renewal: renewal === null ? null : memo(renewal),
        extension: extension === null ? null : memo(extension),
        signatures: SIGNATURES,
      }),
      ACTOR,
    );
  const ids = async (raw: Record<string, unknown>): Promise<string[]> =>
    (
      await fleetLicenseExpenseService.list(
        ListFleetLicenseExpensesQuerySchema.parse({ ...JULY, ...raw }),
      )
    ).items
      .map((row) => row.id)
      .sort();
  const sorted = (...values: string[]): string[] => [...values].sort();

  let renewalOnly: FleetLicenseExpenseDto;
  let both: FleetLicenseExpenseDto;
  let operationId: string;
  beforeAll(async () => {
    renewalOnly = await write('2023-07-03', 100, null);
    both = await write('2023-07-10', 200, 300);
    // The renewal of the second record only — each memo of a record settles on its own.
    const op = await fleetCustodyFundService.settle(
      CreateFleetCustodySettlementSchema.parse({
        date: '2023-07-20',
        parts: [{ expenseId: both.id, part: 'renewal' }],
      }),
      ACTOR,
    );
    operationId = op.id;
  });

  it('names the settlement on the memo it settled, and only on that one', async () => {
    const settled = await fleetLicenseExpenseService.get(both.id);
    expect(settled.renewal?.settlement).toEqual({ operationId, date: '2023-07-20' });
    expect(settled.extension?.settlement).toBeNull();
    expect((await fleetLicenseExpenseService.get(renewalOnly.id)).renewal?.settlement).toBeNull();
  });

  it('filters by «التسوية» — a half-settled record is both waiting and settled', async () => {
    expect(await ids({ status: 'waiting' })).toEqual(sorted(renewalOnly.id, both.id));
    expect(await ids({ status: 'settled' })).toEqual([both.id]);
    expect(await ids({ status: 'waiting', kind: 'renewal' })).toEqual([renewalOnly.id]);
    expect(await ids({ status: 'settled', kind: 'renewal' })).toEqual([both.id]);
    expect(await ids({ status: 'waiting', kind: 'extension' })).toEqual([both.id]);
    expect(await ids({ status: 'settled', kind: 'extension' })).toEqual([]);
    expect(ListFleetLicenseExpensesQuerySchema.safeParse({ status: 'paid' }).success).toBe(false);
    // The figures read the same rows.
    const totals = await fleetLicenseExpenseService.summary(
      FleetLicenseExpenseSummaryQuerySchema.parse({ ...JULY, status: 'settled' }),
    );
    expect(totals).toEqual({ count: 1, cars: 2, visaTotal: 500, cashTotal: 0 });
  });

  it('locks the whole settled record — its unsettled memo too — and leaves the rest writable', async () => {
    const current = await fleetLicenseExpenseService.get(both.id);
    await expect(
      fleetLicenseExpenseService.update(
        both.id,
        {
          date: new Date('2023-07-11'),
          renewal: current.renewal,
          extension: memo(999),
          signatures: SIGNATURES,
          version: current.version,
        } as never,
        ACTOR,
      ),
    ).rejects.toMatchObject({ httpStatus: 422 });
    await expect(fleetLicenseExpenseService.remove(both.id, ACTOR)).rejects.toMatchObject({
      httpStatus: 422,
    });
    expect((await FleetLicenseExpenseModel.findById(both.id).lean().exec())?.isDeleted).toBe(false);

    const edited = await fleetLicenseExpenseService.update(
      renewalOnly.id,
      {
        date: new Date('2023-07-04'),
        renewal: memo(150),
        extension: null,
        signatures: SIGNATURES,
        version: renewalOnly.version,
      } as never,
      ACTOR,
    );
    expect(edited.renewal?.items[0]?.amount).toBe(150);
    await fleetLicenseExpenseService.remove(renewalOnly.id, ACTOR);
    expect(await ids({})).toEqual([both.id]);
  });
});
