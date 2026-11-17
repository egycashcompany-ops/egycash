// The org chart's one read (P-ORG-3 §4.3): every row, both catalogs, the branches, the active jobs and
// the live places — the whole company, whatever the reader's data scope, as `/options` reads.
//
// One `find` per collection, lean, then handed to the pure fold in `org-chart.groups.ts`. Writes call
// it with their transaction's `session` so they plan against exactly what they will commit over
// (§5.4); reads call it without one.
import { type ClientSession, Types } from 'mongoose';
import { BranchModel } from '../branches/branch.model';
import { DepartmentModel } from '../departments/department.model';
import { SectionModel } from '../sections/section.model';
import { DepartmentCatalogModel } from '../department-catalog/department-catalog.model';
import { SectionCatalogModel } from '../section-catalog/section-catalog.model';
import { JobTitleModel } from '../job-titles/job-title.model';
import { JobPlaceModel } from '../job-places/job-place.model';
import { type ChartInput } from './org-chart.groups';

interface LeanBase {
  _id: Types.ObjectId;
  code: string;
  name: { ar: string; en: string };
  status: 'active' | 'inactive';
  __v: number;
}

const str = (id: Types.ObjectId | null | undefined): string | null =>
  id == null ? null : String(id);

type ReadResults<T extends readonly (() => Promise<unknown>)[]> = {
  -readonly [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never;
};

/**
 * Several reads. Inside a transaction they run one after another — a session cannot run operations
 * in parallel, and the driver starts the transaction on the first command only, so parallel first
 * reads race it (readCustodyFundTerms does the same); outside one they run together.
 */
export const readAll = async <T extends readonly (() => Promise<unknown>)[]>(
  session: ClientSession | null,
  reads: T,
): Promise<ReadResults<T>> => {
  if (session === null)
    return (await Promise.all(reads.map((read) => read()))) as unknown as ReadResults<T>;
  const results: unknown[] = [];
  for (const read of reads) results.push(await read());
  return results as unknown as ReadResults<T>;
};

export interface LoadOptions {
  session?: ClientSession | undefined;
  /** Load these jobs whatever their status (a job page's DTOs name inactive jobs too). */
  jobIds?: readonly string[];
}

export const loadOrgChart = async (options: LoadOptions = {}): Promise<ChartInput> => {
  const session = options.session ?? null;
  const live = { isDeleted: false };
  const jobFilter =
    options.jobIds === undefined
      ? { ...live, status: 'active' }
      : { ...live, _id: { $in: options.jobIds.map((id) => new Types.ObjectId(id)) } };

  const [departments, sections, departmentEntries, sectionEntries, branches, jobs, places] =
    await readAll(session, [
      () =>
        DepartmentModel.find(live, {
          code: 1,
          name: 1,
          catalogId: 1,
          status: 1,
          branchId: 1,
          createdAt: 1,
        })
          .session(session)
          .lean()
          .exec(),
      () =>
        SectionModel.find(live, {
          code: 1,
          name: 1,
          catalogId: 1,
          status: 1,
          branchId: 1,
          departmentId: 1,
          createdAt: 1,
        })
          .session(session)
          .lean()
          .exec(),
      () =>
        DepartmentCatalogModel.find(live, { code: 1, name: 1, status: 1, __v: 1 })
          .session(session)
          .lean()
          .exec(),
      () =>
        SectionCatalogModel.find(live, {
          code: 1,
          name: 1,
          status: 1,
          __v: 1,
          departmentCatalogId: 1,
        })
          .session(session)
          .lean()
          .exec(),
      () => BranchModel.find(live, { name: 1 }).session(session).lean().exec(),
      () =>
        JobTitleModel.find(jobFilter, { code: 1, name: 1, status: 1, __v: 1 })
          .session(session)
          .lean()
          .exec(),
      () =>
        JobPlaceModel.find(live, { jobTitleId: 1, departmentCatalogId: 1, sectionCatalogId: 1 })
          .session(session)
          .lean()
          .exec(),
    ] as const);

  return {
    departmentRows: departments.map((row) => ({
      id: String(row._id),
      code: row.code,
      name: row.name,
      catalogId: str(row.catalogId),
      status: row.status,
      branchId: String(row.branchId),
      createdAt: row.createdAt,
    })),
    sectionRows: sections.map((row) => ({
      id: String(row._id),
      code: row.code,
      name: row.name,
      catalogId: str(row.catalogId),
      status: row.status,
      branchId: String(row.branchId),
      departmentId: String(row.departmentId),
      createdAt: row.createdAt,
    })),
    departmentEntries: (departmentEntries as unknown as LeanBase[]).map((entry) => ({
      id: String(entry._id),
      code: entry.code,
      name: entry.name,
      status: entry.status,
      version: entry.__v,
    })),
    sectionEntries: (
      sectionEntries as unknown as (LeanBase & { departmentCatalogId: Types.ObjectId })[]
    ).map((entry) => ({
      id: String(entry._id),
      code: entry.code,
      name: entry.name,
      status: entry.status,
      version: entry.__v,
      departmentCatalogId: String(entry.departmentCatalogId),
    })),
    branches: branches.map((branch) => ({ id: String(branch._id), name: branch.name })),
    jobs: (jobs as unknown as LeanBase[]).map((job) => ({
      id: String(job._id),
      code: job.code,
      name: job.name,
      version: job.__v,
      status: job.status,
    })),
    places: places.map((place) => ({
      id: String(place._id),
      jobTitleId: String(place.jobTitleId),
      departmentCatalogId: String(place.departmentCatalogId),
      sectionCatalogId: str(place.sectionCatalogId),
    })),
  };
};
