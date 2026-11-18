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
import { JobPapersModel } from '../../src/modules/hr/contracts/job-papers/job-papers.model';
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

/**
 * A branch whose NAME is unique, not just its code.
 *
 * `branchService` is the one org unit that refuses a duplicate name (`assertNameAvailable`), and the
 * cleanup below deliberately leaves branches alone — every case here cares about a branch's id, not
 * its label. Reusing a readable name across cases therefore failed the second case that used it.
 */
const makeBranch = async (name: string) => {
  const unique = code('BR');
  return branchService.create(
    { code: unique, name: { ar: `${name} ${unique}`, en: `${name} ${unique}` } },
    ACTOR,
  );
};

beforeEach(async () => {
  // Every case builds its own org chart; leftovers from the last one would join its folded groups.
  // Branches are NOT cleared — `makeBranch` gives each a unique name instead, which keeps a case
  // that reads a branch id independent of one that does not.
  await Promise.all([
    DepartmentModel.deleteMany({}),
    SectionModel.deleteMany({}),
    DepartmentCatalogModel.deleteMany({}),
    SectionCatalogModel.deleteMany({}),
    EmployeeModel.deleteMany({}),
    JobPapersModel.deleteMany({}),
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

  /**
   * The invariant the whole redesign rests on, proved by the index rather than by a check.
   *
   * The assertion is on the MESSAGE, not on a raw `code: 11000`: `BaseRepository.create` catches
   * the driver's duplicate-key error and re-throws a `ConflictError` naming the fields of the index
   * that was violated. That translation is what makes this worth asserting at all — naming
   * `branchId + catalogId` proves it was `ux_branch_catalog` that refused the second declaration
   * and not `ux_code` or some other constraint the fixture tripped by accident.
   */
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
    await expect(declare()).rejects.toThrow(/branchId \+ catalogId/);
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

/**
 * Rows as history wrote them: never linked. Since P-ORG-3 the department and section services link a
 * new row to the company list when they create it (§5.6), so the "legacy" rows the migration exists
 * for are inserted through the models, as the employees here already are.
 */
const legacyDepartment = async (
  input: { code: string; branchId: string; name: { ar: string; en: string } },
  _by?: string,
) => {
  const _id = new Types.ObjectId();
  return DepartmentModel.create({
    _id,
    code: input.code,
    branchId: new Types.ObjectId(input.branchId),
    name: input.name,
    catalogId: null,
    status: 'active',
    path: `${input.branchId}/${String(_id)}`,
  });
};

const legacySection = async (
  input: { code: string; departmentId: string; name: { ar: string; en: string } },
  _by?: string,
) => {
  const department = await DepartmentModel.findById(input.departmentId).lean().exec();
  if (department === null) throw new Error('legacySection: no such department');
  const _id = new Types.ObjectId();
  return SectionModel.create({
    _id,
    code: input.code,
    branchId: department.branchId,
    departmentId: department._id,
    name: input.name,
    catalogId: null,
    status: 'active',
    path: `${String(department.branchId)}/${String(department._id)}/${String(_id)}`,
  });
};

describe('the migration, against real rows', () => {
  /** Seven branches each holding «العمليات», exactly the shape the owner reported. */
  const sevenBranches = async (name: string): Promise<string[]> => {
    const ids: string[] = [];
    for (let n = 0; n < 7; n += 1) {
      const branch = await makeBranch(`فرع ${String(n)}`);
      const row = await legacyDepartment(
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
      await legacyDepartment(
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
    const loser = await legacyDepartment(
      { code: 'DEP-9041', branchId: String(branch._id), name: { ar: 'العليا', en: 'Top' } },
      ACTOR,
    );
    const winner = await legacyDepartment(
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
    await legacyDepartment(
      { code: 'DEP-A1', branchId: String(a._id), name: { ar: 'العمليات', en: 'Ops' } },
      ACTOR,
    );
    await legacyDepartment(
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
      const department = await legacyDepartment(
        { code: code('DEP'), branchId: String(branch._id), name: { ar: 'العمليات', en: 'Ops' } },
        ACTOR,
      );
      await legacySection(
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

  /**
   * «مستندات الوظائف» keep a department's lines under `catalogId ?? row id`, so linking would leave
   * every line saved on a branch copy unread. The migration moves them with the department.
   */
  describe('«مستندات الوظائف» follow their department', () => {
    const paperLine = async (
      departmentId: Types.ObjectId,
      jobTitleId: Types.ObjectId,
      added: string[],
      updatedAt: Date,
    ) => {
      const doc = await JobPapersModel.create({ departmentId, jobTitleId, added, removed: [] });
      await JobPapersModel.collection.updateOne({ _id: doc._id }, { $set: { updatedAt } });
      return doc;
    };
    const live = async () => JobPapersModel.find({ isDeleted: false }).lean().exec();

    it('moves each line to the entry, keeps one per job, and names the lines that disagreed', async () => {
      const ids = await sevenBranches('العمليات');
      const [driver, guard] = [new Types.ObjectId(), new Types.ObjectId()];
      await JobPapersModel.db.collection('job_titles').insertMany([
        { _id: driver, name: { ar: 'سائق', en: 'Driver' } },
        { _id: guard, name: { ar: 'حارس', en: 'Guard' } },
      ]);
      const row = (n: number) => new Types.ObjectId(ids[n]);
      // The driver's line on two copies, saying different things; the guard's on two, the same.
      await paperLine(row(0), driver, ['weapon'], new Date('2026-10-01'));
      const newest = await paperLine(row(1), driver, ['card'], new Date('2026-11-01'));
      await paperLine(row(2), guard, ['weapon'], new Date('2026-10-01'));
      await paperLine(row(3), guard, ['weapon'], new Date('2026-10-02'));

      const dry = await runOrgCatalogMigration({ write: false, actorId: ACTOR });
      expect(dry.papers.moves).toBe(2);
      expect(dry.papers.retired).toBe(2);
      expect(dry.papers.conflicts).toEqual([
        {
          department: 'العمليات',
          job: 'سائق',
          kept: { from: expect.any(String), added: ['card'], removed: [] },
          dropped: [{ from: expect.any(String), added: ['weapon'], removed: [] }],
        },
      ]);
      expect(await live()).toHaveLength(4); // the dry run moved nothing

      const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
      expect(report.written).toBe(true);
      const entry = await DepartmentCatalogModel.findOne({ isDeleted: false }).lean().exec();
      const lines = await live();
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(String(line.departmentId)).toBe(String(entry?._id));
      const driverLine = lines.find((line) => String(line.jobTitleId) === String(driver));
      expect(String(driverLine?._id)).toBe(String(newest._id));
      expect(driverLine?.added).toEqual(['card']);
    });

    it('moves a merged department\'s lines to where its survivor\'s go', async () => {
      const branch = await makeBranch('المهندسين');
      const loser = await legacyDepartment(
        { code: 'DEP-8041', branchId: String(branch._id), name: { ar: 'العليا', en: 'Top' } },
        ACTOR,
      );
      await legacyDepartment(
        { code: 'CAI-80', branchId: String(branch._id), name: { ar: 'العليا', en: 'Top' } },
        ACTOR,
      );
      await paperLine(loser._id, new Types.ObjectId(), ['weapon'], new Date('2026-10-01'));

      const report = await runOrgCatalogMigration({
        write: true,
        actorId: ACTOR,
        merges: [{ loserCode: 'DEP-8041', winnerCode: 'CAI-80' }],
      });
      expect(report.plan.problems).toEqual([]);
      const entry = await DepartmentCatalogModel.findOne({ isDeleted: false }).lean().exec();
      const lines = await live();
      expect(lines.map((line) => String(line.departmentId))).toEqual([String(entry?._id)]);
    });
  });

  /**
   * The company list may already hold the department: given by hand on its page, or created when a
   * department was added on its own page since P-ORG-3 (§5.6). The rows join that entry.
   */
  describe('an entry the company list already has', () => {
    it('is joined, not duplicated', async () => {
      const existing = await departmentCatalogService.create(
        { code: 'OPS', name: { ar: 'العمليات', en: 'Operations' } },
        ACTOR,
      );
      const ids = await sevenBranches('العمليات');

      const dry = await runOrgCatalogMigration({ write: false, actorId: ACTOR });
      expect(dry.joined.departments).toEqual([
        { code: expect.any(String), name: 'العمليات', entryCode: 'OPS' },
      ]);
      // Every copy takes the entry's spelling, and the dry run lists each one that changes.
      expect(dry.renames).toHaveLength(7);
      expect(dry.renames[0]?.to).toEqual({ ar: 'العمليات', en: 'Operations' });

      const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
      expect(report.plan.problems).toEqual([]);
      expect(report.created.departmentEntries).toBe(0);
      expect(await DepartmentCatalogModel.countDocuments({ isDeleted: false })).toBe(1);
      const rows = await DepartmentModel.find({ _id: { $in: ids } }).lean().exec();
      for (const row of rows) {
        expect(String(row.catalogId)).toBe(String(existing._id));
        expect(row.name.en).toBe('Operations'); // the entry's spelling
      }
    });

    it('joins a section under it too, rather than making a second', async () => {
      const entry = await departmentCatalogService.create(
        { code: 'OPS', name: { ar: 'العمليات', en: 'Operations' } },
        ACTOR,
      );
      const section = await sectionCatalogService.create(
        { code: 'TRS', name: { ar: 'الخزينة', en: 'Treasury' }, departmentCatalogId: String(entry._id) },
        ACTOR,
      );
      const branch = await makeBranch('أ');
      const department = await legacyDepartment(
        { code: code('DEP'), branchId: String(branch._id), name: { ar: 'العمليات', en: 'Ops' } },
        ACTOR,
      );
      const row = await legacySection(
        { code: code('SEC'), departmentId: String(department._id), name: { ar: 'الخزينه', en: 'Treasury' } },
        ACTOR,
      );

      const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
      expect(report.plan.problems).toEqual([]);
      expect(report.joined.sections).toHaveLength(1);
      expect(report.created.sectionEntries).toBe(0);
      expect(await SectionCatalogModel.countDocuments({ isDeleted: false })).toBe(1);
      expect(String((await SectionModel.findById(row._id).lean().exec())?.catalogId)).toBe(String(section._id));
    });

    it('refuses while a branch already holds a linked copy beside an unlinked one, and names the merge', async () => {
      const entry = await departmentCatalogService.create(
        { code: 'OPS', name: { ar: 'العمليات', en: 'Operations' } },
        ACTOR,
      );
      const branch = await makeBranch('أ');
      const linked = await legacyDepartment(
        { code: 'DEP-L1', branchId: String(branch._id), name: { ar: 'العمليات', en: 'Operations' } },
        ACTOR,
      );
      await DepartmentModel.updateOne({ _id: linked._id }, { $set: { catalogId: entry._id } });
      await legacyDepartment(
        { code: 'DEP-U1', branchId: String(branch._id), name: { ar: 'العمليات', en: 'Ops' } },
        ACTOR,
      );

      const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
      expect(report.written).toBe(false);
      expect(report.plan.problems.join(' ')).toContain('--merge DEP-U1=DEP-L1');
      expect(await DepartmentModel.countDocuments({ catalogId: entry._id })).toBe(1);

      // The merge it names resolves it.
      const merged = await runOrgCatalogMigration({
        write: true,
        actorId: ACTOR,
        merges: [{ loserCode: 'DEP-U1', winnerCode: 'DEP-L1' }],
      });
      expect(merged.plan.problems).toEqual([]);
      expect(merged.written).toBe(true);
      expect(await DepartmentCatalogModel.countDocuments({ isDeleted: false })).toBe(1);
    });
  });

  describe('what the dry run checks before anything is written', () => {
    const db = () => DepartmentModel.db;

    it('gives a planned entry a free code when the company list already holds its code', async () => {
      await departmentCatalogService.create({ code: 'DEP-7001', name: { ar: 'الأمن', en: 'Security' } }, ACTOR);
      const branch = await makeBranch('أ');
      await legacyDepartment({ code: 'DEP-7001', branchId: String(branch._id), name: { ar: 'العمليات', en: 'Ops' } }, ACTOR);

      const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
      expect(report.plan.problems).toEqual([]);
      expect(report.recoded).toEqual([{ name: 'العمليات', from: 'DEP-7001', to: 'DC-0001' }]);
      expect(report.written).toBe(true);
      expect(await DepartmentCatalogModel.countDocuments({ isDeleted: false })).toBe(2);
    });

    it('keeps a row\'s English name where the company list has only the Arabic again', async () => {
      // As the workforce importer wrote them: the Arabic name in English too.
      const entry = await departmentCatalogService.create({ code: 'TOP', name: { ar: 'العليا', en: 'العليا' } }, ACTOR);
      const branch = await makeBranch('أ');
      const row = await legacyDepartment(
        { code: 'CAI-90', branchId: String(branch._id), name: { ar: 'العليا', en: 'Top Management' } },
        ACTOR,
      );

      const dry = await runOrgCatalogMigration({ write: false, actorId: ACTOR });
      expect(dry.englishKept).toEqual([{ code: 'TOP', name: 'العليا', en: 'Top Management' }]);
      expect(dry.renames).toEqual([]);

      const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
      expect(report.written).toBe(true);
      expect((await DepartmentCatalogModel.findById(entry._id).lean().exec())?.name.en).toBe('Top Management');
      expect((await DepartmentModel.findById(row._id).lean().exec())?.name).toEqual({ ar: 'العليا', en: 'Top Management' });
    });

    it('gives a new entry the first real English name among its rows, oldest first', async () => {
      const [a, b] = await Promise.all([makeBranch('أ'), makeBranch('ب')]);
      await legacyDepartment({ code: 'DEP-8101', branchId: String(a._id), name: { ar: 'الحركة', en: 'الحركة' } }, ACTOR);
      await legacyDepartment({ code: 'DEP-8102', branchId: String(b._id), name: { ar: 'الحركة', en: 'Fleet' } }, ACTOR);

      const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
      expect(report.englishKept).toEqual([{ code: 'DEP-8101', name: 'الحركة', en: 'Fleet' }]);
      const entry = await DepartmentCatalogModel.findOne({ isDeleted: false }).lean().exec();
      expect(entry?.name).toEqual({ ar: 'الحركة', en: 'Fleet' });
      expect(await DepartmentModel.countDocuments({ catalogId: entry?._id, 'name.en': 'Fleet' })).toBe(2);
    });

    it('refuses to join an entry the company list has stopped', async () => {
      const entry = await departmentCatalogService.create({ code: 'OPS', name: { ar: 'العمليات', en: 'Operations' } }, ACTOR);
      await DepartmentCatalogModel.updateOne({ _id: entry._id }, { $set: { status: 'inactive' } });
      await sevenBranches('العمليات');

      const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
      expect(report.written).toBe(false);
      expect(report.plan.problems.join(' ')).toContain('stopped in the company list');
      expect(await DepartmentModel.countDocuments({ catalogId: { $ne: null } })).toBe(0);
    });

    it('lists an approval chain that starts applying, and waits for leave requests already awaiting it', async () => {
      const entry = await departmentCatalogService.create({ code: 'OPS', name: { ar: 'العمليات', en: 'Operations' } }, ACTOR);
      const ids = await sevenBranches('العمليات');
      await db().collection('approval_workflows').insertOne({
        requestType: 'leave', departmentCatalogId: entry._id, branchId: null, isActive: true, isDeleted: false, steps: [],
      });
      const pending = await db().collection('hr_leave_requests').insertOne({
        status: 'pendingApproval', departmentId: new Types.ObjectId(ids[0]), isDeleted: false,
      });
      try {
        const refused = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
        expect(refused.written).toBe(false);
        expect(refused.approvals).toEqual({ chains: [{ requestType: 'leave', department: 'العمليات' }], pendingRequests: 1 });
        expect(refused.plan.problems.join(' ')).toContain('awaiting approval');

        // Decided: the chain is still listed, and nothing stops the run.
        await db().collection('hr_leave_requests').updateOne({ _id: pending.insertedId }, { $set: { status: 'approved' } });
        const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
        expect(report.approvals.pendingRequests).toBe(0);
        expect(report.approvals.chains).toHaveLength(1);
        expect(report.written).toBe(true);
      } finally {
        await db().collection('approval_workflows').deleteMany({});
        await db().collection('hr_leave_requests').deleteMany({});
      }
    });

    it('warns where the plan groups names the screens show apart', async () => {
      // The importer's fold joins ظ and ض; the screens' does not.
      const [a, b] = await Promise.all([makeBranch('أ'), makeBranch('ب')]);
      await legacyDepartment({ code: code('DEP'), branchId: String(a._id), name: { ar: 'الحفظ', en: 'Keeping' } }, ACTOR);
      await legacyDepartment({ code: code('DEP'), branchId: String(b._id), name: { ar: 'الحفض', en: 'Keeping' } }, ACTOR);

      const report = await runOrgCatalogMigration({ write: false, actorId: ACTOR });
      expect(report.plan.departments).toHaveLength(1);
      expect(report.warnings.join(' ')).toContain('joins names the screens show apart');
    });
  });

  it('leaves an organization with nothing in it alone', async () => {
    const report = await runOrgCatalogMigration({ write: true, actorId: ACTOR });
    expect(report.plan.problems).toEqual([]);
    expect(report.created).toEqual({ departmentEntries: 0, sectionEntries: 0 });
  });
});
