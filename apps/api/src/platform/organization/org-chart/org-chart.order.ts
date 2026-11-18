// The order of a column's jobs on the org chart (P-ORG-3 §5.7).
//
// «لما باجي أشد حاجة عشان أغير ترتيبها مش بتتشد»: a department's direct jobs, and each section's, are
// shown in the order the editor sets by dragging a job or with its arrows. The order is a property of
// the PLACE (`job_title_places.position`), not of the job: a job in two sections stands where each of
// them puts it.
//
// ONE write per gesture, like every chart write: the whole column in its new order, in one
// transaction that loads the column through its session, checks the list is exactly the column, and
// numbers the places 0..n-1. The job's own update (§5.2) never touches `position`, so a place it keeps
// keeps its position and a place it adds follows the ordered ones until the column is ordered again.
import { Types } from 'mongoose';
import { ErrorCodes, type LocalizedString, type OrderChartColumn } from '@ecms/contracts';
import { BusinessRuleError, StaleDocumentError } from '../../../shared/errors';
import { unitOfWork } from '../../kernel/unit-of-work';
import { auditService, type AuditEntry } from '../../audit';
import { JobPlaceModel } from '../job-places/job-place.model';
import { indexOrgChart, type ChartInput, type ChartPlace } from './org-chart.groups';
import { loadOrgChart } from './org-chart.load';

const lower = (id: string | null): string | null => (id === null ? null : id.toLowerCase());

const notEditable = (what: string): never => {
  throw new BusinessRuleError(`${what} cannot be edited here`, ErrorCodes.ORG_UNIT_NOT_EDITABLE);
};

/**
 * The column's places in the order the chart shows them: by position, unpositioned ones after, and
 * among equals in the order of the chart's job list — the order the page itself sorts by (web
 * `chart-model.ts`, `columnsOf`), so the audit's «before» is what the editor was looking at.
 */
export const columnInChartOrder = (
  input: ChartInput,
  departmentCatalogId: string,
  sectionCatalogId: string | null,
): ChartPlace[] => {
  const jobOrder = new Map(
    input.jobs.filter((job) => job.status === 'active').map((job, i) => [job.id, i]),
  );
  const department = departmentCatalogId.toLowerCase();
  const section = lower(sectionCatalogId);
  return input.places
    .filter(
      (place) =>
        jobOrder.has(place.jobTitleId) &&
        place.departmentCatalogId.toLowerCase() === department &&
        lower(place.sectionCatalogId) === section,
    )
    .sort(
      (a, b) =>
        (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY) ||
        (jobOrder.get(a.jobTitleId) ?? 0) - (jobOrder.get(b.jobTitleId) ?? 0),
    );
};

export const chartOrder = {
  /** Put one column's jobs in the order given (the whole column, each job once). */
  async set(input: OrderChartColumn, by: string): Promise<void> {
    const audit = await unitOfWork(async (session): Promise<AuditEntry | null> => {
      const chart = await loadOrgChart({ session });
      const index = indexOrgChart(chart);

      // The same groups the chart lets a job be placed in (§4.2): an editable department, and an
      // editable, shown section of THAT department.
      const department = index.departmentByEntry.get(input.departmentCatalogId.toLowerCase());
      if (department === undefined || !department.shown || !department.editable)
        return notEditable('This department');
      if (input.sectionCatalogId !== null) {
        const found = index.sectionByEntry.get(input.sectionCatalogId.toLowerCase());
        if (
          found === undefined ||
          found.department !== department ||
          !found.section.shown ||
          !found.section.editable
        )
          return notEditable('This section');
      }

      const column = columnInChartOrder(chart, input.departmentCatalogId, input.sectionCatalogId);
      const byJob = new Map(column.map((place) => [place.jobTitleId.toLowerCase(), place]));
      const wanted = input.jobTitleIds.map((id) => id.toLowerCase());
      // Exactly the column: the list was made from the chart as it is now, or it is refused.
      if (wanted.length !== column.length || wanted.some((id) => !byJob.has(id))) {
        throw new StaleDocumentError('The column changed since the chart was read — reload it');
      }

      const before = column.map((place) => place.jobTitleId.toLowerCase());
      const unchanged =
        before.every((id, i) => id === wanted[i]) &&
        wanted.every((id, i) => byJob.get(id)?.position === i);
      if (unchanged) return null;

      const actor = new Types.ObjectId(by);
      await JobPlaceModel.bulkWrite(
        wanted.map((id, position) => ({
          updateOne: {
            filter: { _id: new Types.ObjectId(byJob.get(id)?.id), isDeleted: false },
            update: { $set: { position, updatedBy: actor } },
          },
        })),
        { session, ordered: true },
      );

      const names = new Map(chart.jobs.map((job) => [job.id.toLowerCase(), job.name]));
      const labels = (ids: readonly string[]): string[] =>
        ids.map((id) => (names.get(id) ?? ({ ar: id, en: id } as LocalizedString)).ar);
      if (before.every((id, i) => id === wanted[i])) return null; // numbered, not reordered
      return {
        entityRef:
          input.sectionCatalogId === null
            ? { moduleId: 'platform', entityType: 'departmentCatalog', entityId: input.departmentCatalogId }
            : { moduleId: 'platform', entityType: 'sectionCatalog', entityId: input.sectionCatalogId },
        action: 'update',
        changes: [{ field: 'jobOrder', old: labels(before), new: labels(wanted) }],
      };
    });
    // After the commit, as every chart write records (§5.4): a rolled-back reorder leaves no row.
    if (audit !== null) await auditService.recordMany([audit]);
  },
};
