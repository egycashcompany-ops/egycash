// Resolve an employee's placement ids to NAMES, for a whole page at once.
//
// `employment` on the document carries four ids. A list of 2,600 people that sent the client to
// four catalogues to name them would be four extra requests per screen and, worse, four
// permissions: the sections and job-titles catalogues are paginated at 100 and gated by their own
// `*.view`, so a reader without those keys — or a deployment with 139 sections — would see blanks
// for people who are placed perfectly well. The server holds the ids; it resolves them.
//
// ONE READ PER CATALOGUE PER PAGE, never one per row. The lookup is a pure function of what came
// back, so the mapping is testable without a database.
import { type Types } from 'mongoose';
import { type EmployeePlacementDto, type EmployeePlacementUnitDto } from '@ecms/contracts';
import {
  branchRepository,
  departmentRepository,
  jobTitleRepository,
  sectionRepository,
} from '../../../../platform/organization';
import { type EmployeeDoc } from './employee.model';

/** The one thing every org unit and the job-title catalogue have in common. */
export interface NamedUnit {
  _id: Types.ObjectId;
  code: string;
  name: { ar: string; en: string };
}

/** The four catalogues, as returned — order irrelevant, missing ids simply absent. */
export interface PlacementCatalogues {
  branches: readonly NamedUnit[];
  departments: readonly NamedUnit[];
  sections: readonly NamedUnit[];
  jobTitles: readonly NamedUnit[];
}

export interface PlacementLookup {
  for(doc: EmployeeDoc): EmployeePlacementDto;
}

const byId = (units: readonly NamedUnit[]): Map<string, EmployeePlacementUnitDto> =>
  new Map(
    units.map((u) => [String(u._id), { id: String(u._id), code: u.code, name: { ...u.name } }]),
  );

const pick = (
  map: Map<string, EmployeePlacementUnitDto>,
  id: Types.ObjectId | null | undefined,
): EmployeePlacementUnitDto | null => (id == null ? null : (map.get(String(id)) ?? null));

/**
 * Build the lookup from catalogues already fetched. Pure — this is what the spec exercises.
 *
 * An id that resolves to nothing yields `null`, not a throw: the reference may point at a unit
 * that was hard-deleted, and a registry page must not 500 over one stale link.
 */
export const placementLookup = (catalogues: PlacementCatalogues): PlacementLookup => {
  const branches = byId(catalogues.branches);
  const departments = byId(catalogues.departments);
  const sections = byId(catalogues.sections);
  const jobTitles = byId(catalogues.jobTitles);
  return {
    for: (doc) => ({
      branch: pick(branches, doc.employment.branchId),
      department: pick(departments, doc.employment.departmentId),
      section: pick(sections, doc.employment.sectionId),
      jobTitle: pick(jobTitles, doc.employment.jobTitleId),
    }),
  };
};

const ids = (docs: readonly EmployeeDoc[], of: (d: EmployeeDoc) => Types.ObjectId | null | undefined) =>
  docs.flatMap((d) => {
    const id = of(d);
    return id == null ? [] : [String(id)];
  });

/** Fetch the four catalogues for exactly the ids these documents reference, then build the lookup. */
export const resolvePlacements = async (docs: readonly EmployeeDoc[]): Promise<PlacementLookup> => {
  if (docs.length === 0) return placementLookup({ branches: [], departments: [], sections: [], jobTitles: [] });
  const [branches, departments, sections, jobTitles] = await Promise.all([
    branchRepository.findByIdsSystem(ids(docs, (d) => d.employment.branchId)),
    departmentRepository.findByIdsSystem(ids(docs, (d) => d.employment.departmentId)),
    sectionRepository.findByIdsSystem(ids(docs, (d) => d.employment.sectionId)),
    jobTitleRepository.findByIdsSystem(ids(docs, (d) => d.employment.jobTitleId)),
  ]);
  return placementLookup({
    branches: branches as unknown as NamedUnit[],
    departments: departments as unknown as NamedUnit[],
    sections: sections as unknown as NamedUnit[],
    jobTitles: jobTitles as unknown as NamedUnit[],
  });
};
