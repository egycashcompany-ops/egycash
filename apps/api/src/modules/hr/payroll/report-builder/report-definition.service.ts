// Report definitions — the CRUD half of scope B1.
//
// A definition is a question somebody wrote down. This service stores it, edits it, retires it, and
// nothing else: it computes no figure, reads no payslip, and knows no employee. Execution lives
// next door in `report-execution.service.ts`, and the split is the reason this file needs no
// organizational scope at all — there is no money here for a scope to narrow.
//
// VALIDATION IS THE CONTRACT'S. `CreatePayrollReportDefinitionSchema` already refuses a duplicate
// dimension, a sort key naming nothing selected, a filter value that does not fit its field. What
// this file adds is the ONE rule a schema cannot see: whether each calculated column can actually be
// computed over this source's catalog, which needs the catalog and therefore the API.
import {
  type CreatePayrollReportDefinition,
  type EntityRef,
  type UpdatePayrollReportDefinition,
  type PayrollReportDefinitionDto,
  type Paginated,
} from '@ecms/contracts';
import { type FilterQuery } from 'mongoose';
import { auditService } from '../../../../platform/audit';
import { assertColumnsValid } from './report-row';
import { reportDefinitionRepository } from './report-definition.repository';
import { type ReportDefinitionDoc } from './report-definition.model';

const entityRef = (id: string): EntityRef => ({
  moduleId: 'hr',
  entityType: 'payrollReportDefinition',
  entityId: id,
});

/** What audit records — the shape of the question, not a rendering of it. */
const snapshot = (doc: ReportDefinitionDoc): Record<string, unknown> => ({
  name: doc.name,
  sourceId: doc.sourceId,
  dimensions: doc.dimensions,
  measures: doc.measures,
  filters: doc.filters,
  sort: doc.sort,
  columns: doc.columns,
  status: doc.status,
});

const changed = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { field: string; old: unknown; new: unknown }[] =>
  Object.keys(after)
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, old: before[field] ?? null, new: after[field] ?? null }));

export interface ListReportDefinitionsQuery {
  page: number;
  pageSize: number;
  sortBy?: string | undefined;
  sortDir: 'asc' | 'desc';
  status?: 'active' | 'inactive' | undefined;
  search?: string | undefined;
}

class ReportDefinitionService {
  /**
   * Store a definition, once its columns are known to be computable.
   *
   * The check runs BEFORE the write, so a definition that could never produce a number never
   * becomes a row somebody has to discover and delete.
   */
  async create(input: CreatePayrollReportDefinition, by: string): Promise<ReportDefinitionDoc> {
    assertColumnsValid(input.columns);
    const doc = await reportDefinitionRepository.create(
      {
        name: input.name,
        description: input.description,
        sourceId: input.sourceId,
        dimensions: input.dimensions,
        measures: input.measures,
        filters: input.filters,
        sort: input.sort,
        columns: input.columns,
        status: input.status,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: changed({}, snapshot(doc)),
    });
    return doc;
  }

  /**
   * Replace the whole definition, at the version the editor last read (D-B1-5, corrected).
   *
   * The concurrency check is not performed here and could not be: `updateById` matches `__v` INSIDE
   * the update, so between the read above and the write below there is no window for a second
   * editor to slip through. A mismatch raises the platform's `StaleDocumentError` (409) and writes
   * NOTHING — the update is one atomic `findOneAndUpdate`, so a failed version check cannot leave
   * half a definition behind.
   *
   * The `before` read is for the audit entry only. If it loses the race, the write refuses anyway.
   */
  async update(
    id: string,
    input: UpdatePayrollReportDefinition,
    by: string,
  ): Promise<ReportDefinitionDoc> {
    assertColumnsValid(input.columns);
    const before = await reportDefinitionRepository.getById(id);
    const after = await reportDefinitionRepository.updateById(
      id,
      {
        name: input.name,
        description: input.description,
        sourceId: input.sourceId,
        dimensions: input.dimensions,
        measures: input.measures,
        filters: input.filters,
        sort: input.sort,
        columns: input.columns,
        status: input.status,
      },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: changed(snapshot(before), snapshot(after)),
    });
    return after;
  }

  /**
   * Soft delete — the definition stops being offered; no report anybody ran is un-run.
   *
   * `softDeleteById` takes no version, and that is the platform's shape for every entity rather
   * than a gap here: it still goes through the base repository, so the scope filter and the write
   * conditions apply. What it does not do is refuse a delete because somebody edited first.
   */
  async softDelete(id: string, by: string): Promise<void> {
    await reportDefinitionRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async getById(id: string): Promise<ReportDefinitionDoc> {
    return reportDefinitionRepository.getById(id);
  }

  async list(query: ListReportDefinitionsQuery): Promise<Paginated<ReportDefinitionDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.search !== undefined) {
      // Escaped before it becomes a pattern: a search box is not a place to author a regular
      // expression, and an unescaped one is how a list read turns into a scan somebody wrote.
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return reportDefinitionRepository.list({
      filter: filter as FilterQuery<ReportDefinitionDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['status', 'createdAt'],
    });
  }

  /** `version` is exposed so an editor can send it back on the next update (D-B1-5, corrected). */
  toDto(doc: ReportDefinitionDoc): PayrollReportDefinitionDto {
    return {
      id: String(doc._id),
      name: doc.name,
      description: doc.description,
      sourceId: doc.sourceId,
      dimensions: doc.dimensions,
      measures: doc.measures,
      filters: doc.filters,
      sort: doc.sort,
      columns: doc.columns,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const reportDefinitionService = new ReportDefinitionService();
