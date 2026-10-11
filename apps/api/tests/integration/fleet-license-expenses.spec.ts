// «مصروفات التراخيص» against a real mongo — a renewal, an extension, or both in one record; nothing
// in a half is required; a hand-typed plate keeps no car; an edit is versioned; a delete is soft;
// and the set-up's signatures start from the department's own names.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import {
  CreateFleetCatalogItemSchema,
  CreateFleetLicenseExpenseSchema,
  FleetLicenseExpenseSummaryQuerySchema,
  ListFleetLicenseExpensesQuerySchema,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetLicenseExpenseModel } from '../../src/modules/fleet/license-expenses/license-expense.model';
import {
  DEFAULT_LICENSE_EXPENSE_SIGNATURES,
  fleetLicenseExpenseService,
} from '../../src/modules/fleet/license-expenses/license-expense.service';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { fleetCatalogItemService } from '../../src/modules/fleet/catalogs/catalog-item.service';
import { toCatalogItemDto } from '../../src/modules/fleet/fleet.mappers';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const ACTOR = new Types.ObjectId().toString();
const SIGNATURES = { agent: 'أ', director: 'ب', generalManager: 'ج\nد' };

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
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
