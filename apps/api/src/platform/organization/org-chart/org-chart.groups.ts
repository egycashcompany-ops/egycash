// The org chart's read model, pure (P-ORG-3 §4). Given every department and section row, both
// catalogs, the branches, the active jobs and the live job places, it answers what the page draws:
// one group per company department, the section groups inside each, and every job's places.
//
// FOLDING IS `orgUnitGroupKeys`, UNCHANGED. The crew card already folds branch copies with it, and
// a second rule would let the two screens disagree about what "the same department" is. Sections are
// folded inside each department group, never company-wide: «الإدارة» under Operations and «الإدارة»
// under Security are two sections that share a word.
//
// NO I/O HERE. `org-chart.load.ts` reads; this decides. The writes (§5.2, §5.3) use the same answer to
// know what is shown and what is editable, so a request can never be judged by a different rule than
// the screen that made it.
import {
  orgUnitGroupKeys,
  type LocalizedString,
  type OrgChartDepartmentDto,
  type OrgChartDto,
  type OrgChartJobDto,
  type OrgChartSectionDto,
} from '@ecms/contracts';

export interface ChartRow {
  id: string;
  code: string;
  name: LocalizedString;
  catalogId: string | null;
  status: 'active' | 'inactive';
  branchId: string;
  createdAt: Date;
}

export interface ChartSectionRow extends ChartRow {
  departmentId: string;
}

export interface ChartEntry {
  id: string;
  code: string;
  name: LocalizedString;
  status: 'active' | 'inactive';
  version: number;
}

export interface ChartSectionEntry extends ChartEntry {
  departmentCatalogId: string;
}

export interface ChartBranch {
  id: string;
  name: LocalizedString;
}

export interface ChartJob {
  id: string;
  code: string;
  name: LocalizedString;
  version: number;
}

export interface ChartPlace {
  id: string;
  jobTitleId: string;
  departmentCatalogId: string;
  sectionCatalogId: string | null;
}

export interface ChartInput {
  departmentRows: readonly ChartRow[];
  sectionRows: readonly ChartSectionRow[];
  departmentEntries: readonly ChartEntry[];
  sectionEntries: readonly ChartSectionEntry[];
  branches: readonly ChartBranch[];
  /** The ACTIVE jobs — the only ones the chart lists. */
  jobs: readonly ChartJob[];
  /** Every live place, of any job. */
  places: readonly ChartPlace[];
}

/** One folded group of rows, with what the page and the writes need to know about it. */
export interface ChartGroup {
  key: string;
  /** The catalog entry the key names, when it names one that exists. */
  entry: ChartEntry | null;
  rows: ChartRow[];
  /** At least one row is active (§4.2). */
  shown: boolean;
  /** A catalog group whose entry is active (§4.2). */
  editable: boolean;
  name: LocalizedString;
}

export interface ChartSectionGroup extends ChartGroup {
  rows: ChartSectionRow[];
  entry: ChartSectionEntry | null;
}

export interface ChartDepartmentGroup extends ChartGroup {
  sections: ChartSectionGroup[];
}

export interface ChartIndex {
  departments: ChartDepartmentGroup[];
  /** Department groups by their catalog entry id. */
  departmentByEntry: Map<string, ChartDepartmentGroup>;
  /** Section groups by their catalog entry id. */
  sectionByEntry: Map<string, { department: ChartDepartmentGroup; section: ChartSectionGroup }>;
  /** Is this place's department (and section, if any) shown? */
  placeShown: (place: Pick<ChartPlace, 'departmentCatalogId' | 'sectionCatalogId'>) => boolean;
}

const byCreatedAt = <T extends { createdAt: Date; id: string }>(a: T, b: T): number =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

const byName = (a: { name: LocalizedString }, b: { name: LocalizedString }): number =>
  a.name.ar.localeCompare(b.name.ar, 'ar');

/** Group `rows` with `orgUnitGroupKeys`, keeping each group's rows oldest first. */
const fold = <R extends ChartRow>(rows: readonly R[]): Map<string, R[]> => {
  const keys = orgUnitGroupKeys(rows);
  const groups = new Map<string, R[]>();
  for (const row of [...rows].sort(byCreatedAt)) {
    const key = keys.get(row.id) ?? `unit:${row.id}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
};

const entryIdOf = (key: string): string | null => (key.startsWith('catalog:') ? key.slice(8) : null);

const describe = <R extends ChartRow, E extends ChartEntry>(
  key: string,
  rows: R[],
  entries: ReadonlyMap<string, E>,
): { entry: E | null; shown: boolean; editable: boolean; name: LocalizedString } => {
  const entryId = entryIdOf(key);
  const entry = entryId === null ? null : (entries.get(entryId) ?? null);
  const shown = rows.some((row) => row.status === 'active');
  const oldestActive = rows.find((row) => row.status === 'active') ?? rows[0];
  return {
    entry,
    shown,
    editable: entry !== null && entry.status === 'active',
    name: entry?.name ?? oldestActive?.name ?? { ar: '', en: '' },
  };
};

/** Fold every row into groups and answer the questions §4 asks of them. */
export const indexOrgChart = (input: ChartInput): ChartIndex => {
  const departmentEntries = new Map(input.departmentEntries.map((e) => [e.id, e]));
  const sectionEntries = new Map(input.sectionEntries.map((e) => [e.id, e]));

  const departments: ChartDepartmentGroup[] = [];
  for (const [key, rows] of fold(input.departmentRows)) {
    const facts = describe(key, rows, departmentEntries);
    const rowIds = new Set(rows.map((row) => row.id));
    const sections: ChartSectionGroup[] = [];
    for (const [sectionKey, sectionRows] of fold(
      input.sectionRows.filter((row) => rowIds.has(row.departmentId)),
    )) {
      const sectionFacts = describe(sectionKey, sectionRows, sectionEntries);
      // A section entry that belongs to another department's entry is not this department's section,
      // whatever its rows say — the rule a section row's create already enforces.
      const misfiled =
        sectionFacts.entry !== null &&
        (facts.entry === null || sectionFacts.entry.departmentCatalogId !== facts.entry.id);
      sections.push({
        key: sectionKey,
        rows: sectionRows,
        ...sectionFacts,
        // Writable only where its department is too: a section write names both (§5.3).
        editable: sectionFacts.editable && facts.editable && !misfiled,
      });
    }
    sections.sort(byName);
    departments.push({ key, rows, ...facts, sections });
  }
  departments.sort(byName);

  const departmentByEntry = new Map<string, ChartDepartmentGroup>();
  const sectionByEntry = new Map<string, { department: ChartDepartmentGroup; section: ChartSectionGroup }>();
  for (const department of departments) {
    if (department.entry !== null) departmentByEntry.set(department.entry.id, department);
    for (const section of department.sections) {
      // Only a section entry that belongs to THIS department's entry is its section; a misfiled one
      // (its rows sit here, its entry elsewhere) answers to no department.
      if (section.entry !== null && section.entry.departmentCatalogId === department.entry?.id) {
        sectionByEntry.set(section.entry.id, { department, section });
      }
    }
  }

  const placeShown: ChartIndex['placeShown'] = (place) => {
    const department = departmentByEntry.get(place.departmentCatalogId);
    if (department === undefined || !department.shown) return false;
    if (place.sectionCatalogId === null) return true;
    const section = sectionByEntry.get(place.sectionCatalogId);
    return section !== undefined && section.department === department && section.section.shown;
  };

  return { departments, departmentByEntry, sectionByEntry, placeShown };
};

/** The DTO `GET /platform/org-chart` answers with (§4.4). */
export const toOrgChartDto = (input: ChartInput, index: ChartIndex = indexOrgChart(input)): OrgChartDto => {
  const branchNames = new Map(input.branches.map((b) => [b.id, b.name]));
  const branchesOf = (rows: readonly ChartRow[]) =>
    [...new Set(rows.filter((row) => row.status === 'active').map((row) => row.branchId))]
      .map((id) => ({ id, name: branchNames.get(id) ?? { ar: '', en: '' } }))
      .sort(byName);

  const departments: OrgChartDepartmentDto[] = index.departments
    .filter((department) => department.shown)
    .map((department) => {
      const sections: OrgChartSectionDto[] = department.sections
        .filter((section) => section.shown)
        .map((section) => ({
          key: section.key,
          sectionCatalogId: section.entry?.id ?? null,
          editable: section.editable,
          name: section.name,
          branches: branchesOf(section.rows),
          catalogVersion: section.entry?.version ?? null,
        }));
      const entryId = department.entry?.id ?? null;
      return {
        key: department.key,
        departmentCatalogId: entryId,
        editable: department.editable,
        name: department.name,
        branches: branchesOf(department.rows),
        linkedBranchIds:
          entryId === null
            ? []
            : [
                ...new Set(
                  department.rows
                    .filter((row) => row.status === 'active' && row.catalogId === entryId)
                    .map((row) => row.branchId),
                ),
              ],
        sections,
      };
    });

  const placesByJob = new Map<string, ChartPlace[]>();
  for (const place of input.places) {
    const list = placesByJob.get(place.jobTitleId) ?? [];
    list.push(place);
    placesByJob.set(place.jobTitleId, list);
  }
  const jobs: OrgChartJobDto[] = input.jobs.map((job) => ({
    id: job.id,
    code: job.code,
    name: job.name,
    version: job.version,
    places: (placesByJob.get(job.id) ?? []).map((place) => ({
      departmentCatalogId: place.departmentCatalogId,
      sectionCatalogId: place.sectionCatalogId,
      shown: index.placeShown(place),
    })),
  }));

  return { departments, jobs };
};
