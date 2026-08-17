// The payroll report builder — the DEFINITION half (scope B1).
//
// P-HR-25 answered "what did this run cost, arranged by X" with the arrangement arriving inside each
// request and forgotten with the response. This file is the other half: the same arrangement,
// authored once and STORED, so a person composes a report rather than a caller composing a query.
//
// THE P-HR-15 RULE IS UNCHANGED AND STILL SATISFIED. A report is a definition — who reads it, which
// rows, which columns — and this system still invents none. Everything below is a vocabulary for a
// person to say what they want; nothing here names a business figure anybody has to be given.
//
// NAMES, NEVER PATHS. Every field a request can mention is a NAME from a closed list — `'branch'`,
// not `'$branchId'`. The mapping from a name to a database path lives in the API and is unreachable
// from a request, which is what makes "no field path from the user reaches Mongo" true by
// construction rather than by validation.
import { z } from 'zod';
import { LocalizedStringSchema, objectId, type LocalizedString } from '../common/index.js';
import { MoneyCurrencySchema } from './hr-payroll-money.js';
import {
  COMPENSATION_LINE_ORIGINS,
  PAY_ITEM_KINDS,
  PayrollReportColumnSchema,
  type PayrollReportColumn,
} from './hr-payroll.js';

// ── The source, closed at one ───────────────────────────────────────────────

/**
 * The one thing a report may be built over: the payslip lines of a single payroll run.
 *
 * A list of one, deliberately — a second source reopens where the report engine lives (D-REPORT-2)
 * and is a phase of its own, not a value added here.
 */
export const PAYROLL_REPORT_SOURCES = ['payrollRunLines'] as const;
export const PayrollReportSourceSchema = z.enum(PAYROLL_REPORT_SOURCES);
export type PayrollReportSource = (typeof PAYROLL_REPORT_SOURCES)[number];

// ── Dimensions and measures ─────────────────────────────────────────────────

/**
 * What a report may group by.
 *
 * `currency` IS NOT ON THIS LIST, and that is the point: it is part of every grouping key, always,
 * and can be neither selected nor removed. There is no exchange rate anywhere in this system, so a
 * row spanning two currencies would be a defect wearing the costume of a summary.
 *
 * `costCenter` is the snapshot stamped on the payslip at issue (P-HR-23), never today's membership.
 * `payItem` carries the code the LINE stored, so a later rename cannot restate a paid document.
 */
export const PAYROLL_REPORT_DIMENSIONS = [
  'kind',
  'origin',
  'payItem',
  'branch',
  'costCenter',
] as const;
export const PayrollReportDimensionSchema = z.enum(PAYROLL_REPORT_DIMENSIONS);
export type PayrollReportDimension = (typeof PAYROLL_REPORT_DIMENSIONS)[number];

/**
 * What a report may total.
 *
 * Exactly what the existing pipeline already computes — a count of lines and a sum of minor units
 * (D-B1-2). An average or a maximum is a new aggregation, and adding one is a decision rather than
 * a convenience.
 */
export const PAYROLL_REPORT_MEASURES = ['lineCount', 'amountMinor'] as const;
export const PayrollReportMeasureSchema = z.enum(PAYROLL_REPORT_MEASURES);
export type PayrollReportMeasure = (typeof PAYROLL_REPORT_MEASURES)[number];

// ── Filters ─────────────────────────────────────────────────────────────────

/** A filter may name a dimension, or the currency every row already carries. Nothing else. */
export const PAYROLL_REPORT_FILTER_FIELDS = ['currency', ...PAYROLL_REPORT_DIMENSIONS] as const;
export const PayrollReportFilterFieldSchema = z.enum(PAYROLL_REPORT_FILTER_FIELDS);
export type PayrollReportFilterField = (typeof PAYROLL_REPORT_FILTER_FIELDS)[number];

/** Four operators over categorical values (D-B1-3). No `gt`, because no dimension here is ordered. */
export const PAYROLL_REPORT_FILTER_OPS = ['eq', 'ne', 'in', 'nin'] as const;
export const PayrollReportFilterOpSchema = z.enum(PAYROLL_REPORT_FILTER_OPS);
export type PayrollReportFilterOp = (typeof PAYROLL_REPORT_FILTER_OPS)[number];

/**
 * Selects the group where the dimension is null.
 *
 * That group is REAL — a payslip issued before cost centres existed, a line belonging to no pay
 * item — and D-REPORT-7 shows it rather than hiding it. Showing a group that cannot then be filtered
 * to would be an odd half-measure, so it gets a name.
 */
export const PAYROLL_REPORT_NULL_VALUE = 'none';

/** How many filters, and how many values in one filter. A report, not a query language. */
export const PAYROLL_REPORT_MAX_FILTERS = 10;
export const PAYROLL_REPORT_MAX_FILTER_VALUES = 50;
export const PAYROLL_REPORT_MAX_DIMENSIONS = 5;

/** Fields whose values are entity ids; everything else is a member of a closed vocabulary. */
const ID_VALUED_FIELDS: readonly PayrollReportFilterField[] = ['payItem', 'branch', 'costCenter'];

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * Whether a value is legal FOR THE FIELD IT FILTERS.
 *
 * Validating shape alone would let `branch: 'earning'` through — schema-valid, and meaningless. So
 * each field states what its values look like, and the boundary refuses the rest before anything
 * reaches a query builder.
 */
const valueFitsField = (field: PayrollReportFilterField, value: string): boolean => {
  if (value === PAYROLL_REPORT_NULL_VALUE) return field !== 'currency';
  if (ID_VALUED_FIELDS.includes(field)) return OBJECT_ID.test(value);
  if (field === 'kind') return (PAY_ITEM_KINDS as readonly string[]).includes(value);
  if (field === 'origin') return (COMPENSATION_LINE_ORIGINS as readonly string[]).includes(value);
  return MoneyCurrencySchema.safeParse(value).success;
};

/**
 * One filter.
 *
 * ONE SHAPE FOR ALL FOUR OPERATORS, with `eq`/`ne` refusing anything but a single value. The screen
 * renders one control instead of two, the API validates one schema instead of two, and "equals"
 * never quietly means "equals any of".
 */
export const PayrollReportFilterSchema = z
  .object({
    field: PayrollReportFilterFieldSchema,
    op: PayrollReportFilterOpSchema,
    values: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(PAYROLL_REPORT_MAX_FILTER_VALUES),
  })
  .strict()
  .superRefine((filter, ctx) => {
    if ((filter.op === 'eq' || filter.op === 'ne') && filter.values.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['values'],
        message: `"${filter.op}" takes exactly one value`,
      });
    }
    filter.values.forEach((value, index) => {
      if (!valueFitsField(filter.field, value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['values', index],
          message: `"${value}" is not a valid value for ${filter.field}`,
        });
      }
    });
  });
export type PayrollReportFilter = z.infer<typeof PayrollReportFilterSchema>;

// ── Sorting ─────────────────────────────────────────────────────────────────

export const PAYROLL_REPORT_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const PayrollReportSortDirectionSchema = z.enum(PAYROLL_REPORT_SORT_DIRECTIONS);

/** `key` must be one of the dimensions or measures the definition itself selected — see the refine. */
export const PayrollReportSortSchema = z
  .object({
    key: z.string().min(1).max(40),
    direction: PayrollReportSortDirectionSchema,
  })
  .strict();
export type PayrollReportSort = z.infer<typeof PayrollReportSortSchema>;

// ── The definition ──────────────────────────────────────────────────────────

export const PAYROLL_REPORT_STATUSES = ['active', 'inactive'] as const;
export const PayrollReportStatusSchema = z.enum(PAYROLL_REPORT_STATUSES);
export type PayrollReportStatus = (typeof PAYROLL_REPORT_STATUSES)[number];

const definitionBody = {
  name: LocalizedStringSchema,
  description: LocalizedStringSchema.nullable().default(null),
  sourceId: PayrollReportSourceSchema,
  dimensions: z.array(PayrollReportDimensionSchema).max(PAYROLL_REPORT_MAX_DIMENSIONS).default([]),
  measures: z.array(PayrollReportMeasureSchema).min(1),
  filters: z.array(PayrollReportFilterSchema).max(PAYROLL_REPORT_MAX_FILTERS).default([]),
  sort: PayrollReportSortSchema.nullable().default(null),
  /** The P-HR-24 AST, reused exactly — this phase adds no expression capability of its own. */
  columns: z.array(PayrollReportColumnSchema).max(10).default([]),
  status: PayrollReportStatusSchema.default('active'),
};

/**
 * The cross-field rules a single field cannot state.
 *
 * A duplicate dimension would group by the same thing twice; a sort key naming something the report
 * does not select would order by a column nobody can see; two columns sharing a key would silently
 * become one. Each is checked here so the answer arrives at the boundary rather than as a confusing
 * result later.
 */
const coherent = <T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> =>
  schema.superRefine((value, ctx) => {
    const body = value as z.infer<typeof PayrollReportDefinitionBodySchema>;

    const dupDimension = body.dimensions.find((d, i) => body.dimensions.indexOf(d) !== i);
    if (dupDimension !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensions'],
        message: `"${dupDimension}" is selected more than once`,
      });
    }

    const dupMeasure = body.measures.find((m, i) => body.measures.indexOf(m) !== i);
    if (dupMeasure !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['measures'],
        message: `"${dupMeasure}" is selected more than once`,
      });
    }

    const columnKeys = body.columns.map((column) => column.key);
    const dupColumn = columnKeys.find((k, i) => columnKeys.indexOf(k) !== i);
    if (dupColumn !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['columns'],
        message: `column "${dupColumn}" is defined more than once`,
      });
    }

    if (body.sort !== null) {
      const sortable: string[] = [...body.dimensions, ...body.measures, ...columnKeys, 'currency'];
      if (!sortable.includes(body.sort.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sort', 'key'],
          message: `"${body.sort.key}" is not one of this report's dimensions, measures or columns`,
        });
      }
    }
  }) as unknown as z.ZodEffects<T>;

/** The definition without identity — what a create sends, and what a preview executes unsaved. */
export const PayrollReportDefinitionBodySchema = z.object(definitionBody).strict();
export type PayrollReportDefinitionBody = z.infer<typeof PayrollReportDefinitionBodySchema>;

export const CreatePayrollReportDefinitionSchema = coherent(PayrollReportDefinitionBodySchema);
export type CreatePayrollReportDefinition = z.infer<typeof PayrollReportDefinitionBodySchema>;

/**
 * An edit replaces the whole definition.
 *
 * A partial patch over a shape whose parts must agree — a sort key that matches the dimensions, a
 * filter whose field is still selected — would need the stored half to validate the sent half. The
 * whole body is simpler to reason about and impossible to make incoherent.
 */
export const UpdatePayrollReportDefinitionSchema = CreatePayrollReportDefinitionSchema;
export type UpdatePayrollReportDefinition = z.infer<typeof PayrollReportDefinitionBodySchema>;

export interface PayrollReportDefinitionDto {
  id: string;
  name: LocalizedString;
  description: LocalizedString | null;
  sourceId: PayrollReportSource;
  dimensions: PayrollReportDimension[];
  measures: PayrollReportMeasure[];
  filters: PayrollReportFilter[];
  sort: PayrollReportSort | null;
  columns: PayrollReportColumn[];
  status: PayrollReportStatus;
  /** Exposed, not enforced (D-B1-5): there is no stored execution for a stale edit to restate. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Execution ───────────────────────────────────────────────────────────────

/**
 * Run an unsaved definition (D-B1-6).
 *
 * The builder must be able to show what a report WILL say before somebody commits to it, and
 * `POST /hr/contracts/preview` already establishes the shape in this codebase: a request that
 * computes and returns, and writes nothing.
 */
export const PreviewPayrollReportSchema = z
  .object({
    runId: objectId(),
    definition: CreatePayrollReportDefinitionSchema,
  })
  .strict();
export type PreviewPayrollReport = z.infer<typeof PreviewPayrollReportSchema>;

/** Run a stored definition: the report is known, only the run is chosen. */
export const RunPayrollReportSchema = z.object({ runId: objectId() }).strict();
export type RunPayrollReport = z.infer<typeof RunPayrollReportSchema>;

/**
 * One dimension's value on one row.
 *
 * `id` is null for the real group where the dimension is absent, and `label` is null when the
 * record behind an id cannot be read — money is never withheld because a label was.
 */
export interface PayrollReportCellDto {
  dimension: PayrollReportDimension;
  id: string | null;
  code: string | null;
  label: LocalizedString | null;
}

export interface PayrollReportRowDto {
  /** Always present, never selectable — see `PAYROLL_REPORT_DIMENSIONS`. */
  currency: string;
  cells: PayrollReportCellDto[];
  /** One entry per selected measure, keyed by its name. */
  measures: Record<string, number>;
  /** One entry per calculated column. `null` is "could not be computed", shown as an empty cell. */
  calculated: Record<string, number | null>;
}

export interface PayrollReportResultDto {
  runId: string;
  period: string;
  /** Echoed so a result can never be read as an answer to a different question. */
  dimensions: PayrollReportDimension[];
  measures: PayrollReportMeasure[];
  columns: string[];
  rows: PayrollReportRowDto[];
}
