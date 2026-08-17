// A saved report definition (scope B1).
//
// THE FIRST THING THIS SYSTEM STORES ABOUT A REPORT. P-HR-25 answered a question that arrived with
// each request and kept nothing; this keeps the question so a person can ask it again tomorrow.
//
// WHAT IS DELIBERATELY ABSENT. No owner and no sharing (D-REPORT-11): a definition is not private
// property, and what a reader SEES is decided at execution by their own scope, not by a field here.
// No stored result and no execution history: a report is re-run, never replayed, so there is no
// figure here that could go stale against the payslips it summed.
//
// The definition holds NAMES from closed vocabularies — `'branch'`, `'amountMinor'` — never database
// paths. The mapping to a path lives in `report-dimensions.ts` and cannot be reached from a stored
// document any more than from a request.
import { Schema, model } from 'mongoose';
import {
  PAYROLL_REPORT_DIMENSIONS,
  PAYROLL_REPORT_FILTER_FIELDS,
  PAYROLL_REPORT_FILTER_OPS,
  PAYROLL_REPORT_MEASURES,
  PAYROLL_REPORT_SORT_DIRECTIONS,
  PAYROLL_REPORT_SOURCES,
  PAYROLL_REPORT_STATUSES,
  type LocalizedString,
  type PayrollReportColumn,
  type PayrollReportDimension,
  type PayrollReportFilter,
  type PayrollReportMeasure,
  type PayrollReportSort,
  type PayrollReportSource,
  type PayrollReportStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';
import { localizedField } from '../../../../platform/organization/shared/org-unit';

export interface ReportDefinitionDoc extends BaseDocFields {
  name: LocalizedString;
  description: LocalizedString | null;
  sourceId: PayrollReportSource;
  dimensions: PayrollReportDimension[];
  measures: PayrollReportMeasure[];
  filters: PayrollReportFilter[];
  sort: PayrollReportSort | null;
  columns: PayrollReportColumn[];
  status: PayrollReportStatus;
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

/**
 * A filter, stored as the vocabulary states it.
 *
 * `values` are STRINGS here, exactly as they arrived — the same `none` token, the same hex id — and
 * they become database values only inside `report-dimensions.ts`, at execution. Storing them
 * already converted would put a database representation in a document that is supposed to hold a
 * person's question.
 */
const filterSubSchema = new Schema(
  {
    field: { type: String, enum: [...PAYROLL_REPORT_FILTER_FIELDS], required: true },
    op: { type: String, enum: [...PAYROLL_REPORT_FILTER_OPS], required: true },
    values: { type: [String], required: true },
  },
  { _id: false },
);

const sortSubSchema = new Schema(
  {
    key: { type: String, required: true },
    direction: { type: String, enum: [...PAYROLL_REPORT_SORT_DIRECTIONS], required: true },
  },
  { _id: false },
);

/**
 * A calculated column: a key and a P-HR-24 expression tree.
 *
 * `Schema.Types.Mixed` because the tree is recursive and Mongoose cannot describe it — and it does
 * not need to. The contract validates the shape on the way in, and `validateExpression` checks it
 * again against the row catalog before anything is evaluated. A document that somehow held a
 * malformed tree would evaluate to null rather than to a wrong number.
 */
const columnSubSchema = new Schema(
  {
    key: { type: String, required: true },
    expression: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const reportDefinitionSchema = new Schema<ReportDefinitionDoc>(
  {
    name: localizedField,
    description: { type: localizedSubSchema, default: null },
    sourceId: { type: String, enum: [...PAYROLL_REPORT_SOURCES], required: true },
    dimensions: { type: [{ type: String, enum: [...PAYROLL_REPORT_DIMENSIONS] }], default: [] },
    measures: { type: [{ type: String, enum: [...PAYROLL_REPORT_MEASURES] }], required: true },
    filters: { type: [filterSubSchema], default: [] },
    sort: { type: sortSubSchema, default: null },
    columns: { type: [columnSubSchema], default: [] },
    status: { type: String, enum: [...PAYROLL_REPORT_STATUSES], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Listing is by name within a status, and that is the only read this collection has.
reportDefinitionSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_created' });

export const ReportDefinitionModel = model<ReportDefinitionDoc>(
  'HrReportDefinition',
  reportDefinitionSchema,
  'hr_report_definitions',
);
