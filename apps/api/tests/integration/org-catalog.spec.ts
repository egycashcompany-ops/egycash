// The org-unit catalog and its migration, against a real database (P-ORG-2).
//
// The unit tests decide what the migration WOULD do. Only a real Mongo can answer the questions
// that broke things before: does the partial unique index actually refuse the second declaration
// and actually permit two unlinked rows; does the reference sweep really reach an id nested inside
// a sub-document array; does a second run really write nothing.
//
// It exercises the SERVICES rather than HTTP. The permission surface is pinned by source in
// `org-catalog-guards.spec.ts` — what a database is needed for is the writing.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import {
  branchService,
  departmentCatalogService,
  departmentService,
  DepartmentCatalogModel,
  DepartmentModel,
  sectionCatalogService,
  sectionService,
  SectionCatalogModel,
  SectionModel,
  toDepartmentDto,
} from '../../src/platform/organization';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { runOrgCatalogMigration } from '../../src/org-catalog-migration/apply';

let replSet: MongoMemoryReplSet | null = null;
const ACTOR = new Types.ObjectId().toString();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env['MONGO_TEST_URI'];
  if (external !== undefined && external !== '') return external;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(`ecms-org-catalog-${String(Date.now())}`);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

let seq = 0;
const code = (prefix: string): string => {
  seq += 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
};

const makeBranch = async (name: string) =>
  branchService.create({ code: code('BR'), name: { ar: name, en: name } }, ACTOR);

beforeEach(async () => {
  // Every case builds its own org chart; leftovers from the last one would join its folded groups.
  await Promise.all([
    DepartmentModel.deleteMany({}),
    SectionModel.deleteMany({}),
    DepartmentCatalogModel.deleteMany({}),
    SectionCatalogModel.deleteMany({}),
    EmployeeModel.deleteMany({}),
  ]);
});

describe('declaring a company-wide department in a branch', () => {
  it('gives two branches the same entry, spelled the same way, without either typing it', async () => {
    const entry = await departmentCatalogService.create(
      { code: code('DC'), name: { ar: 'العمليات', en: 'Operations' } },
      ACTOR,
    );
    const [cairo, tanta] = await Promise.all([makeBranch('المهندسين'), makeBranch('طنطا')]);

    const rows = await Promise.all(
      [cairo, tanta].map((branch) =>
        departmentService.create(
          { code: code('DEP'), branchId: String(branch._id), catalogId: String(entry._id) },
          ACTOR,
        ),
      ),
    );

    for (const row of rows) {
      expect(toDepartmentDto(row).catalogId).toBe(String(entry._id));
      expect(row.name.ar).toBe('العمليات');
    }
    // …and they remain two rows, each in its own branch. Nobody moved.
    expect(new Set(rows.map((row) => String(row.branchId))).size).toBe(2);
  });

  /** The invariant the whole redesign rests on, proved by the index rather than by a check. */
  it('refuses the same entry twice in one branch', async () => {
    const entry = await departmentCatalogService.create(
      { code: code('DC'), name: { ar: 'الخزينة', en: 'Treasury' } },
      ACTOR,
    );
    const branch = await makeBranch('بورسعيد');
    const declare = () =>
      departmentService.create(
        { code: code('DEP'), branchId: String(branch._id), catalogId: String(entry._id) },
        ACTOR,
      );

    await declare();
    await expect(declare()).rejects.toMatchObject({ code: 11000 });
  });

  /**
   * The partial filter earning its place: a deployment with no catalog at all must still be able to
   * put two departments in one branch. A full `{branchId, catalogId}` index would refuse the second.
   */
  it('still allows two departments in one branch when neither names an entry', async () => {
    const branch = await makeBranch('أسيوط');
    const plain = (name: string) =>
      departmentService.create(
        { code: code('DEP'), branchId: String(branch._id), name: { ar: name, en: name } },
        ACTOR,
      );
    await plain('الأمن');
    await expect(plain('المشتريات')).resolves.toBeDefined();
  });

  it('refuses an entry that is not active', async () => {
    const entry = await departmentCatalogService.create(
      { code: code('DC'), name: { ar: 'المصنع', en: 'Factory' } },
      ACTOR,
    );
    await departmentCatalogService.update(
      String(entry._id),
      { status: 'inactive', version: entry.__v },
      ACTOR,
    );
    const branch = await makeBranch('الشروق');
    await expect(
      departmentService.create(
        { code: code('DEP'), branchId: String(branch._id), catalogId: String(entry._id) },
        ACTOR,
      ),
    ).rejects.toThrow(/no longer active/);
  });
});

describe('the catalog is one name, kept true', () => {
  it('refuses a second entry by the same name', async () => {
    await departmentCatalogService.create(
      { code: code('DC'), name: { ar: 'الأمن', en: 'Security' } },
      ACTOR,
    );
    await expect(
      departmentCatalogService.create(
        { code: code('DC'), name: { ar: 'الأمن', en: 'Security' } },
        ACTOR,
      ),
    ).rejects.toThrow(/already has a department named/);
  });

  it('carries a rename down to every branch that declared it', async () => {
    const entry = await departmentCatalogService.create(
      { code: code('DC'), name: { ar: 'الحركه', en: 'Fleet' } },
      ACTOR,
    );
    const branches = await Promise.all([makeBranch('أ'), makeBranch('ب'), makeBranch('ج')]);
    for (const branch of branches) {
      await departmentService.create(
        { code: code('DEP'), branchId: String(branch._id), catalogId: String(entry._id) },
        ACTOR,
      );
    }

    await departmentCatalogService.update(
      String(entry._id),
      { name: { ar: 'الحركة', en: 'Fleet Operations' }, version: entry.__v },
      ACTOR,
    );

    const rows = await DepartmentModel.find({ catalogId: entry._id }).lean().exec();
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.name.ar).toBe('الحركة');
  });

  it('refuses to delete an entry a branch still declares', async () => {
    const entry = await departmentCatalogService.create(
      { code: code('DC'), name: { ar: 'الماليه', en: 'Finance' } },
      ACTOR,
    );
    const branch = await makeBranch('د');
    const row = await departmentService.create(
      { code: code('DEP'), branchId: String(branch._id), catalogId: String(entry._id) },
      ACTOR,
    );

    await expect(departmentCatalogService.softDelete(String(entry._id), ACTOR)).rejects.toThrow(
      /branches still declare/,
    );

    await departmentService.softDelete(String(row._id), ACTOR);
    await expect(
      departmentCatalogService.softDelete(String(entry._id), ACTOR),
    ).resolves.toBeUndefined();
  });

  /** A section may only be declared under its own company-wide department. */
  it('refuses a section entry belonging to a different department', async () => {
    const [operations, fleet] = await Promise.all([
      departmentCatalogService.create(
        { code: code('DC'), name: { ar: 'العمليات', en: 'Operations' } },
        ACTOR,
      ),
      departmentCatalogService.create(
        { code: code('DC'), name: { ar: 'الحركة', en: 'Fleet' } },
        ACTOR,
      ),
    ]);
    const counting = await sectionCatalogService.create(
      {
        code: code('SC'),
        name: { ar: 'العد والفرز', en: 'Counting' },
        departmentCatalogId: String(operations._id),
      },
      ACTOR,
    );
    const branch = await makeBranch('هـ');
    const fleetRow = await departmentService.create(
      { code: code('DEP'), branchId: String(branch._id), catalogId: String(fleet._id) },
      ACTOR,
    );

    await expect(
      sectionService.create(
        {
          code: code('SEC'),
          departmentId: String(fleetRow._id),
          catalogId: String(counting._id),
        },
        ACTOR,
      ),
    ).rejects.toThrow(/different company-wide department/);
  });

  /** The same section name under two different departments is two sections, and must stay two. */
  it('allows one section name under two different departments', async () => {
    const [fleet, facilities] = await Promise.all([
      departmentCatalogService.create(
        { code: code('DC'), name: { ar: 'الحركة', en: 'Fleet' } },
        ACTOR,
      ),
      departmentCatalogService.create(
        { code: code('DC'), name: { ar: 'الشئون الإدارية', en: 'Admin' } },
        ACTOR,
      ),
    ]);
    for (const parent of [fleet, facilities]) {
      await expect(
        sectionCatalogService.create(
          {
            code: code('SC'),
            name: { ar: 'الصيانة', en: 'Maintenance' },
            departmentCatalogId: String(parent._id),
          },
          ACTOR,
        ),
      ).resolves.toBeDefined();
    }
  });
});

describe('the migration, against real rows', () => {
  /** Seven branches each holding «العمليات», exactly the shape the owner reported. */
  const sevenBranches = async (name: string): Promise<string[]> => {
    const ids: string[] = [];
    for (let n = 0; n < 7; n += 1) {
      const branch = await makeBranch(`فرع ${String(n)}`);
      const row = await departmentService.create(
        { code: code('DEP'), branchId: String(branch._id), name: { ar: name, en: name } },
        ACTOR,
      );
      ids.push(String(row._id));
    }
    return ids;
  };

  it('a dry run writes nothing at all', async () => {
    await sevenBranches('العمليات');
    const report = await runOrgCatalogMigration({ write: false, actorId: ACTOR });

    expect(report.written).toBe(false);
    expect(report.plan.departments).toHaveLength(1);
    expect(report.plan.departments[0]?.memberIds).toHaveLength(7);
    expect(await DepartmentCatalogModel.countDocuments({})).toBe(0);
    expect(await DepartmentModel.countDocuments({ catalogId: { $ne: null } })).toBe(0);
  });

  it('makes one entry for seven rows and links every one of them', async () => {
    const ids = await sevenBranches('العمليات');
    const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });

    expect(report.plan.problems).toEqual([]);
    expect(report.written).toBe(true);
    expect(report.created.departmentEntries).toBe(1);
    expect(report.linked.departments).toBe(7);

    const entries = await DepartmentCatalogModel.find({ isDeleted: false }).lean().exec();
    expect(entries).toHaveLength(1);
    const linked = await DepartmentModel.find({ _id: { $in: ids } })
      .lean()
      .exec();
    for (const row of linked) expect(String(row.catalogId)).toBe(String(entries[0]?._id));
  });

  it('is a no-op the second time', async () => {
    await sevenBranches('العمليات');
    await runOrgCatalogMigration({ write: true, actorId: ACTOR });
    const second = await runOrgCatalogMigration({ write: true, actorId: ACTOR });

    expect(second.plan.departments).toEqual([]);
    expect(second.plan.alreadyLinked.departments).toBe(7);
    expect(second.created.departmentEntries).toBe(0);
    expect(await DepartmentCatalogModel.countDocuments({ isDeleted: false })).toBe(1);
  });

  /** THE GATE: two of the same name in ONE branch. Nothing is written until a human resolves it. */
  it('refuses while one branch holds the same department twice', async () => {
    const branch = await makeBranch('المهندسين');
    for (const spelling of ['العليا', 'العليا']) {
      await departmentService.create(
        { code: code('DEP'), branchId: String(branch._id), name: { ar: spelling, en: spelling } },
        ACTOR,
      );
    }

    const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
    expect(report.written).toBe(false);
    expect(report.plan.problems).toHaveLength(1);
    expect(await DepartmentCatalogModel.countDocuments({})).toBe(0);
  });

  it('resolves that same gate once a merge is named, and moves the people with it', async () => {
    const branch = await makeBranch('المهندسين');
    const loser = await departmentService.create(
      { code: 'DEP-9041', branchId: String(branch._id), name: { ar: 'العليا', en: 'Top' } },
      ACTOR,
    );
    const winner = await departmentService.create(
      { code: 'CAI-90', branchId: String(branch._id), name: { ar: 'العليا', en: 'Top' } },
      ACTOR,
    );

    // A raw insert, deliberately: what is under test is the reference sweep, not employee creation.
    // The three paths written here are the three the sweep has to find — the denormalized scope
    // copy, the placement of record inside `employment`, and a snapshot inside an array.
    const employeeId = new Types.ObjectId();
    await EmployeeModel.collection.insertOne({
      _id: employeeId,
      isDeleted: false,
      branchId: branch._id,
      departmentId: loser._id,
      employment: { departmentId: loser._id, branchId: branch._id },
    });

    const report = await runOrgCatalogMigration({
      write: true,
      actorId: ACTOR,
      merges: [{ loserCode: 'DEP-9041', winnerCode: 'CAI-90' }],
    });

    expect(report.plan.problems).toEqual([]);
    expect(report.merged.departments).toBe(1);

    const moved = await EmployeeModel.collection.findOne({ _id: employeeId });
    expect(String(moved?.['departmentId'])).toBe(String(winner._id));
    expect(String((moved?.['employment'] as { departmentId: unknown }).departmentId)).toBe(
      String(winner._id),
    );

    const retired = await DepartmentModel.findById(loser._id).lean().exec();
    expect(retired?.isDeleted).toBe(true);
    // One catalog entry, carrying the surviving row only.
    expect(await DepartmentCatalogModel.countDocuments({ isDeleted: false })).toBe(1);
    expect(
      await DepartmentModel.countDocuments({ isDeleted: false, catalogId: { $ne: null } }),
    ).toBe(1);
  });

  it('refuses a merge across branches, and writes nothing', async () => {
    const [a, b] = await Promise.all([makeBranch('أ'), makeBranch('ب')]);
    await departmentService.create(
      { code: 'DEP-A1', branchId: String(a._id), name: { ar: 'العمليات', en: 'Ops' } },
      ACTOR,
    );
    await departmentService.create(
      { code: 'DEP-B1', branchId: String(b._id), name: { ar: 'التشغيل', en: 'Running' } },
      ACTOR,
    );

    const report = await runOrgCatalogMigration({
      write: true,
      actorId: ACTOR,
      merges: [{ loserCode: 'DEP-A1', winnerCode: 'DEP-B1' }],
    });
    expect(report.written).toBe(false);
    expect(report.plan.problems.join(' ')).toContain('different branches');
    expect(await DepartmentCatalogModel.countDocuments({})).toBe(0);
  });

  it('catalogues the sections under the company-wide department they belong to', async () => {
    const branches = await Promise.all([makeBranch('أ'), makeBranch('ب')]);
    for (const branch of branches) {
      const department = await departmentService.create(
        { code: code('DEP'), branchId: String(branch._id), name: { ar: 'العمليات', en: 'Ops' } },
        ACTOR,
      );
      await sectionService.create(
        {
          code: code('SEC'),
          departmentId: String(department._id),
          name: { ar: 'العد والفرز', en: 'Counting' },
        },
        ACTOR,
      );
    }

    const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
    expect(report.plan.problems).toEqual([]);
    expect(report.created.sectionEntries).toBe(1);

    const entry = await SectionCatalogModel.findOne({ isDeleted: false }).lean().exec();
    const departmentEntry = await DepartmentCatalogModel.findOne({ isDeleted: false })
      .lean()
      .exec();
    expect(String(entry?.departmentCatalogId)).toBe(String(departmentEntry?._id));
    expect(await SectionModel.countDocuments({ catalogId: entry?._id })).toBe(2);
  });

  it('leaves an organization with nothing in it alone', async () => {
    const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
    expect(report.plan.problems).toEqual([]);
    expect(report.created).toEqual({ departmentEntries: 0, sectionEntries: 0 });
  });
});
