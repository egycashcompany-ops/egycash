// The report builder's HTTP surface (scope B1).
//
// Every call here is a real request. Nothing is mocked, nothing is computed in the browser: the
// grouping, the filtering, the totals and the calculated columns are all the server's, because they
// are the caller's SCOPE applied to somebody's pay — and a figure a screen worked out for itself
// would be a figure nobody authorized.
import {
  type Paginated,
  type PayrollReportDefinitionDto,
  type PayrollReportResultDto,
  type CreatePayrollReportDefinition,
  type UpdatePayrollReportDefinition,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post, type QueryParams } from '../../../../shared/lib/api-client';

const BASE = '/hr/payroll/reports';

export const listReportDefinitions = (
  params: QueryParams,
): Promise<Paginated<PayrollReportDefinitionDto>> =>
  getPage<PayrollReportDefinitionDto>(`${BASE}${buildQuery(params)}`);

export const getReportDefinition = (id: string): Promise<PayrollReportDefinitionDto> =>
  get<PayrollReportDefinitionDto>(`${BASE}/${id}`);

export const createReportDefinition = (
  body: CreatePayrollReportDefinition,
): Promise<PayrollReportDefinitionDto> => post<PayrollReportDefinitionDto>(BASE, body);

/** Carries the version it read — a stale one comes back as a 409 rather than overwriting. */
export const updateReportDefinition = (
  id: string,
  body: UpdatePayrollReportDefinition,
): Promise<PayrollReportDefinitionDto> => patch<PayrollReportDefinitionDto>(`${BASE}/${id}`, body);

export const deleteReportDefinition = (id: string): Promise<void> => del<void>(`${BASE}/${id}`);

/** Run a stored definition against one payroll run. */
export const runReportDefinition = (
  id: string,
  runId: string,
): Promise<PayrollReportResultDto> =>
  post<PayrollReportResultDto>(`${BASE}/${id}/run`, { runId });

/** Run a definition nobody has saved yet — the same path, the same scope, the same evaluation. */
export const previewReport = (
  runId: string,
  definition: CreatePayrollReportDefinition,
): Promise<PayrollReportResultDto> =>
  post<PayrollReportResultDto>(`${BASE}/preview`, { runId, definition });
