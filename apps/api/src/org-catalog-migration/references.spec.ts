// Finding every place a department id is stored — the half of the merge that is expensive to get
// wrong (P-ORG-2).
//
// A missed collection leaves rows pointing at a department that was just retired: an employee whose
// file says they work somewhere that no longer exists, invisible to the department-scoped readers
// who are supposed to see them. So this is tested twice over — once against hand-built schemas
// that isolate each shape, and once against the REAL models, where the count is asserted to be
// large and to include the paths that are known to be there. The second half is what fails when
// somebody adds a `departmentId` in a shape the walker cannot see.
import { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
// The barrels FIRST, and this is load-bearing rather than stylistic: reaching a model directly
// enters the graph at `department.model` and closes the cycle documented at the top of
// `shared/org-unit.ts`, which fails this file at import time with a TDZ ReferenceError.
// `app-model-graph` is what `apply.ts` imports for the same reason: it registers EVERY model,
// including the platform features reached from the HTTP app rather than from a module manifest.
// Importing exactly what the migration imports is what makes the assertions below say something
// about the migration's real coverage rather than about this file's import list.
import './app-model-graph';
import mongoose from 'mongoose';
import {
  MIXED_ORG_CARRIERS,
  collectModelRefs,
  collectRefPaths,
  mixedCarrierHits,
  repointUpdate,
  uniqueIndexRisks,
} from './references';

const oid = { type: Schema.Types.ObjectId };

describe('the shapes a department id is stored in', () => {
  it('finds a plain scalar', () => {
    const schema = new Schema({ departmentId: oid, branchId: oid });
    expect(collectRefPaths(schema)).toEqual([{ path: 'departmentId', kind: 'scalar' }]);
  });

  /** An employee's `employment` block is a sub-schema, so its paths are not on the parent's map. */
  it('finds one inside a sub-schema, as a dotted path', () => {
    const employment = new Schema({ departmentId: oid }, { _id: false });
    const schema = new Schema({ employment: { type: employment }, departmentId: oid });
    expect(
      collectRefPaths(schema)
        .map((r) => r.path)
        .sort(),
    ).toEqual(['departmentId', 'employment.departmentId']);
  });

  /** A performance cycle names the departments it was addressed to, as an array. */
  it('finds an array of ids and marks it as one', () => {
    const schema = new Schema({ scopeDepartmentIds: [Schema.Types.ObjectId] });
    expect(collectRefPaths(schema)).toEqual([{ path: 'scopeDepartmentIds', kind: 'idArray' }]);
  });

  /**
   * An id inside an array of sub-documents — an applicant's placement history, a job offer's
   * revisions. A dotted path matches these but cannot set one, so the array segment and the
   * remainder are recorded separately for the positional update.
   */
  it('splits an id inside an array of sub-documents into its array and its tail', () => {
    const entry = new Schema({ from: new Schema({ departmentId: oid }, { _id: false }) });
    const schema = new Schema({ history: [entry] });
    expect(collectRefPaths(schema)).toEqual([
      {
        path: 'history.from.departmentId',
        kind: 'documentArray',
        arrayPath: 'history',
        tailPath: 'from.departmentId',
      },
    ]);
  });

  it('ignores every other id, including the section and the branch', () => {
    const schema = new Schema({ sectionId: oid, branchId: oid, costCenterId: oid, name: String });
    expect(collectRefPaths(schema)).toEqual([]);
  });

  /**
   * The leaf SEGMENT is what decides, not a suffix match on the whole path. `approverDepartmentId`
   * is deliberately not swept: nothing declares one, and a rule loose enough to catch it would also
   * catch a field that merely mentions a department without holding a `departments._id`.
   */
  it('matches the leaf segment, not any name ending in the word', () => {
    expect(collectRefPaths(new Schema({ approverDepartmentId: oid }))).toEqual([]);
    const nested = new Schema({ approver: new Schema({ departmentId: oid }, { _id: false }) });
    expect(collectRefPaths(nested)).toEqual([{ path: 'approver.departmentId', kind: 'scalar' }]);
  });
});

describe('unique indexes the repointing could violate', () => {
  it('finds one whose key includes the path, and names the other fields', () => {
    const schema = new Schema({ departmentId: oid, applicationId: oid });
    schema.index(
      { departmentId: 1, applicationId: 1 },
      { unique: true, name: 'ux_department_application' },
    );
    expect(uniqueIndexRisks(schema, 'departmentId')).toEqual([
      { name: 'ux_department_application', otherKeys: ['applicationId'] },
    ]);
  });

  it('ignores an ordinary index — only uniqueness can be violated by a merge', () => {
    const schema = new Schema({ departmentId: oid, status: String });
    schema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });
    expect(uniqueIndexRisks(schema, 'departmentId')).toEqual([]);
  });

  it('ignores a unique index that does not mention the path', () => {
    const schema = new Schema({ departmentId: oid, code: String });
    schema.index({ code: 1 }, { unique: true, name: 'ux_code' });
    expect(uniqueIndexRisks(schema, 'departmentId')).toEqual([]);
  });
});

describe('the collections whose org ids hide inside Mixed', () => {
  it('names both, each with the reason it is reported rather than rewritten', () => {
    expect(MIXED_ORG_CARRIERS.map((c) => c.collection)).toEqual([
      'hr_announcements',
      'hr_notification_rules',
    ]);
    for (const carrier of MIXED_ORG_CARRIERS) expect(carrier.why.length).toBeGreaterThan(20);
  });

  it('finds an id buried anywhere in the document', () => {
    const id = '6a612eb15e5f052c6b88ad87';
    const docs = [
      { _id: 'a', audience: { kind: 'filter', filter: { departmentIds: [id] } } },
      { _id: 'b', audience: { kind: 'everyone' } },
    ];
    expect(mixedCarrierHits(docs, [id])).toEqual(['a']);
  });

  it('finds nothing when nothing is being merged', () => {
    expect(mixedCarrierHits([{ _id: 'a', x: 1 }], [])).toEqual([]);
  });
});

describe('against the real models', () => {
  const refs = collectModelRefs(mongoose.models);
  const paths = refs.map((ref) => `${ref.collection}.${ref.path}`);

  /**
   * The employee file is the one that matters most, and it carries the id TWICE: the placement of
   * record inside `employment`, and the denormalized copy beside it that the data scope filters on.
   * A merge that repointed one and not the other would leave the two disagreeing about where
   * somebody works — the file saying one department, every scoped list saying another.
   */
  it('reaches both copies on the employee', () => {
    expect(paths).toContain('hr_employees.departmentId');
    expect(paths).toContain('hr_employees.employment.departmentId');
  });

  it('reaches the placement inside a user account', () => {
    expect(paths).toContain('users.organization.departmentId');
  });

  it('reaches the sections, which is what actually moves them to the surviving department', () => {
    expect(paths).toContain('sections.departmentId');
  });

  it('reaches the departments-to-applications links, unique index and all', () => {
    expect(paths).toContain('department_applications.departmentId');
    const model = mongoose.models['DepartmentApplication'];
    expect(uniqueIndexRisks(model?.schema as Schema, 'departmentId')).toHaveLength(1);
  });

  it('reaches the array a performance cycle names its departments in', () => {
    const cycle = refs.find((ref) => ref.path === 'scopeDepartmentIds');
    expect(cycle?.kind).toBe('idArray');
  });

  /**
   * Not a pinned number, deliberately. The exact count moves whenever a module gains a field, and a
   * spec that had to be edited for that would teach people to edit it without looking. What is
   * worth holding is that the sweep is BROAD — a walker that silently stopped finding things (a
   * mongoose upgrade changing `paths`, say) collapses this to a handful.
   */
  it('sweeps the whole application, not a corner of it', () => {
    expect(refs.length).toBeGreaterThan(20);
    expect(new Set(refs.map((ref) => ref.collection)).size).toBeGreaterThan(15);
  });

  /**
   * The four snapshot arrays, named because they are the ones a reader would assume are left alone.
   * They are NOT: a merge says two rows were always the same department, so a snapshot that keeps
   * naming the retired duplicate is the falsification, not the repointing. See `repointUpdate`.
   */
  it('reaches the placement snapshots and offer revisions, positionally', () => {
    expect(
      refs
        .filter((ref) => ref.kind === 'documentArray')
        .map((ref) => `${ref.collection}.${ref.path}`),
    ).toEqual([
      'hr_applicants.placementHistory.from.departmentId',
      'hr_applicants.placementHistory.to.departmentId',
      'hr_evaluation_batches.items.placementSnapshot.departmentId',
      'hr_job_offers.revisions.terms.departmentId',
    ]);
  });

  /** Every reference the sweep found must be expressible as an update, or the migration refuses. */
  it('can build a repointing update for every reference it finds', () => {
    const unwritable = refs
      .filter((ref) => repointUpdate(ref, 'loser', 'winner') === null)
      .map((ref) => `${ref.collection}.${ref.path}`);
    expect(unwritable).toEqual([]);
  });

  it('builds the positional form for a snapshot array', () => {
    const ref = refs.find((r) => r.path === 'revisions.terms.departmentId');
    expect(repointUpdate(ref as (typeof refs)[number], 'L', 'W')).toEqual({
      set: { 'revisions.$[element].terms.departmentId': 'W' },
      arrayFilters: [{ 'element.terms.departmentId': 'L' }],
    });
  });

  /** The catalog itself is not a place a department id is stored, and must not be swept. */
  it('does not sweep the departments collection into itself', () => {
    expect(paths.filter((path) => path.startsWith('departments.'))).toEqual([]);
    expect(paths.filter((path) => path.startsWith('department_catalog.'))).toEqual([]);
  });
});
