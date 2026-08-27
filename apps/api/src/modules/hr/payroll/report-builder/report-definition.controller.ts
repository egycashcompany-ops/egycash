// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreatePayrollReportDefinition,
  type PreviewPayrollReport,
  type RunPayrollReport,
  type UpdatePayrollReportDefinition,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../../../infrastructure/http/respond';
import { validated } from '../../../../infrastructure/http/validate';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { reportDefinitionService, type ListReportDefinitionsQuery } from './report-definition.service';
import { reportExecutionService } from './report-execution.service';

type IdParam = { id: string };

/**
 * The scope every execution runs under.
 *
 * `employee.viewCompensation` and not the report key, deliberately: the report key says a person may
 * use the builder, and this says whose pay they may see. Reading the scope from the compensation
 * permission is what makes the same saved definition answer a BRANCH-scoped reader with their branch
 * and an organization-scoped reader with the company.
 *
 * F-B1-1 — AND THE LADDER NOW REACHES THE DEPARTMENT, though not the section. A payslip once
 * carried the branch axis and no second one, so `BaseRepository.scopeFilter` answered a
 * `department` grant with an empty filter and did not narrow the read at all. P-SCOPE-1 stamped
 * `payslip.departmentId` at issue and declared it, closing that for every payslip read at once —
 * the list, the reconciliation and both cost reports included, since all of them scope through the
 * same repository. `section` is still unnarrowed and deliberately so (D-DEPT-5): the section rung
 * was left where it was. `hr-payroll-reports.spec.ts` holds both halves.
 */
const executionScope = (req: Request) =>
  scopeSelector(authContext(req), 'employee.viewCompensation');

export const listReportDefinitions = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListReportDefinitionsQuery>(req);
  const page = await reportDefinitionService.list(query);
  okPage(res, page, (doc) => reportDefinitionService.toDto(doc));
};

export const getReportDefinition = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, reportDefinitionService.toDto(await reportDefinitionService.getById(params.id)));
};

export const createReportDefinition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreatePayrollReportDefinition>(req);
  const doc = await reportDefinitionService.create(body, ctx.userId);
  created(res, reportDefinitionService.toDto(doc), `/api/v1/hr/payroll/reports/${String(doc._id)}`);
};

/**
 * Replace a definition at the version the editor read (D-B1-5, corrected).
 *
 * A stale version reaches the client as the platform's 409, not as a silent overwrite of somebody
 * else's edit.
 */
export const updateReportDefinition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdatePayrollReportDefinition, never, IdParam>(req);
  const doc = await reportDefinitionService.update(params.id, body, ctx.userId);
  ok(res, reportDefinitionService.toDto(doc));
};

export const deleteReportDefinition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await reportDefinitionService.softDelete(params.id, ctx.userId);
  noContent(res);
};

/** Run a stored definition against a run the caller names. */
export const runReportDefinition = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<RunPayrollReport, never, IdParam>(req);
  const definition = await reportDefinitionService.getById(params.id);
  ok(res, await reportExecutionService.run(body.runId, definition, executionScope(req)));
};

/**
 * Run a definition that was never saved (D-B1-6).
 *
 * The builder must be able to show what a report WILL say before somebody commits to it, and it
 * takes the same path as a saved run — the same pipeline, the same scope, the same evaluation — so
 * a preview cannot flatter a definition that would behave differently once stored.
 */
export const previewReport = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PreviewPayrollReport>(req);
  ok(res, await reportExecutionService.run(body.runId, body.definition, executionScope(req)));
};
