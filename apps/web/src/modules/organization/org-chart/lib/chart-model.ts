// The org chart page's pure logic (P-ORG-3 §2, §5.2): which jobs stand in which column, where a job
// may move, and the job's whole set of places after one change — the set the job's own update takes.
import {
  type JobPlaceInput,
  type Locale,
  type OrgChartDepartmentDto,
  type OrgChartDto,
  type OrgChartJobDto,
} from '@ecms/contracts';

const lower = (id: string | null): string | null => (id === null ? null : id.toLowerCase());

/** The tile a `?dept=` key opens: that one, else the first (an unknown key is not an error). */
export const pickDepartment = (
  departments: readonly OrgChartDepartmentDto[],
  key: string | null,
): OrgChartDepartmentDto | null => departments.find((d) => d.key === key) ?? departments[0] ?? null;

export interface DepartmentColumns {
  /** Jobs placed directly under the department. */
  direct: OrgChartJobDto[];
  /** Jobs per section entry id. */
  bySection: Map<string, OrgChartJobDto[]>;
  /** Distinct jobs placed anywhere in the department. */
  jobCount: number;
}

/** Each column's jobs, from the jobs' own places — only places that are shown (§4.2). */
export const columnsOf = (department: OrgChartDepartmentDto, jobs: readonly OrgChartJobDto[]): DepartmentColumns => {
  const direct: OrgChartJobDto[] = [];
  const bySection = new Map<string, OrgChartJobDto[]>();
  const entryId = lower(department.departmentCatalogId);
  const counted = new Set<string>();
  if (entryId === null) return { direct, bySection, jobCount: 0 };
  for (const job of jobs) {
    for (const place of job.places) {
      if (!place.shown || place.departmentCatalogId.toLowerCase() !== entryId) continue;
      counted.add(job.id);
      if (place.sectionCatalogId === null) direct.push(job);
      else {
        const key = place.sectionCatalogId.toLowerCase();
        const list = bySection.get(key) ?? [];
        list.push(job);
        bySection.set(key, list);
      }
    }
  }
  return { direct, bySection, jobCount: counted.size };
};

/** The places a job may move to inside its department: «directly under» first, then each editable section. */
export const moveTargets = (department: OrgChartDepartmentDto): { sectionCatalogId: string | null }[] => [
  { sectionCatalogId: null },
  ...department.sections
    .filter((section) => section.editable && section.sectionCatalogId !== null)
    .map((section) => ({ sectionCatalogId: section.sectionCatalogId })),
];

export type PlaceChange =
  | { kind: 'add'; departmentCatalogId: string; sectionCatalogId: string | null }
  | { kind: 'remove'; departmentCatalogId: string; sectionCatalogId: string | null }
  | { kind: 'move'; departmentCatalogId: string; from: string | null; to: string | null };

const same = (a: JobPlaceInput, b: JobPlaceInput): boolean =>
  a.departmentCatalogId.toLowerCase() === b.departmentCatalogId.toLowerCase() &&
  lower(a.sectionCatalogId) === lower(b.sectionCatalogId);

/**
 * The job's WHOLE set after one change — every place it has, stopped ones included (they are kept,
 * never dropped by a gesture elsewhere), with duplicates merged: a move onto a place the job already
 * has leaves one.
 */
export const placesAfter = (job: OrgChartJobDto, change: PlaceChange): JobPlaceInput[] => {
  const current: JobPlaceInput[] = job.places.map((place) => ({
    departmentCatalogId: place.departmentCatalogId,
    sectionCatalogId: place.sectionCatalogId,
  }));
  let next: JobPlaceInput[];
  if (change.kind === 'add') {
    next = [...current, { departmentCatalogId: change.departmentCatalogId, sectionCatalogId: change.sectionCatalogId }];
  } else if (change.kind === 'remove') {
    const target = { departmentCatalogId: change.departmentCatalogId, sectionCatalogId: change.sectionCatalogId };
    next = current.filter((place) => !same(place, target));
  } else {
    const from = { departmentCatalogId: change.departmentCatalogId, sectionCatalogId: change.from };
    const to = { departmentCatalogId: change.departmentCatalogId, sectionCatalogId: change.to };
    next = current.map((place) => (same(place, from) ? to : place));
  }
  const merged: JobPlaceInput[] = [];
  for (const place of next) if (!merged.some((kept) => same(kept, place))) merged.push(place);
  return merged;
};

/** Is the job already in this exact place? (The add dialog does not offer it there.) */
export const isPlacedAt = (
  job: OrgChartJobDto,
  departmentCatalogId: string,
  sectionCatalogId: string | null,
): boolean =>
  job.places.some((place) => same(place, { departmentCatalogId, sectionCatalogId }));

/** «العمليات › الخزينة» for each of a job's OTHER places — the add dialog's «موجودة أيضًا في». */
export const otherPlaceLabels = (
  job: OrgChartJobDto,
  chart: OrgChartDto,
  locale: Locale,
  except: { departmentCatalogId: string; sectionCatalogId: string | null },
): string[] => {
  const name = (value: { ar: string; en: string }): string => (locale === 'ar' ? value.ar : value.en);
  return job.places
    .filter((place) => !same(place, except))
    .map((place) => {
      const department = chart.departments.find(
        (d) => d.departmentCatalogId?.toLowerCase() === place.departmentCatalogId.toLowerCase(),
      );
      if (department === undefined) return null;
      if (place.sectionCatalogId === null) return name(department.name);
      const section = department.sections.find(
        (s) => s.sectionCatalogId?.toLowerCase() === place.sectionCatalogId?.toLowerCase(),
      );
      return section === undefined ? name(department.name) : `${name(department.name)} › ${name(section.name)}`;
    })
    .filter((label): label is string => label !== null);
};
