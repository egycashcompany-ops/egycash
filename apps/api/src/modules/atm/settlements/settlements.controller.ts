// Thin HTTP mapping only (ADR-003) — /atm/settlements (docs/12-planning/atm-settlements-phase1.md
// §6.3 S1–S22).
//
// The import (S4) is multipart: multer fills `req.body` only after it, so a route `validate(…)`
// cannot run there; this controller parses the fields with `LayoutImportFieldsSchema`, whose
// defaults are the harmless ones — `apply` and `standardLoads` only when exactly 'true', and no
// default `mode` (the register controller's rule).
import { type Request, type Response } from 'express';
import {
  LayoutImportFieldsSchema,
  type AddAtmPlanLines,
  type AddAtmSpareLine,
  type ApiErrorDetail,
  type AtmLineReason,
  type AtmSettlementBankQuery,
  type AtmSettlementContextQuery,
  type AtmSettlementPlanQuery,
  type AtmSettlementPrint,
  type AtmSpareUse,
  type AtmVersionQuery,
  type CreateAtmPlan,
  type IssueAtmPlan,
  type SaveAtmCassetteLayout,
  type SaveAtmStandardLoad,
  type UpdateAtmPlanLine,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { noContent, ok, validated } from '../../../platform/web';
import { ValidationError } from '../../../shared/errors';
import { atmLayoutImportService } from './import/layout-import.service';
import { atmCassetteLayoutService } from './layouts/layout.service';
import { atmSettlementPlanService } from './plans/plan.service';
import { atmSettlementPrintService } from './prints/print.service';
import { atmStandardLoadService } from './standard-loads/standard-load.service';

/** multer hands the original name over as latin1; an Arabic file name is UTF-8 underneath. */
const fileNameOf = (raw: string): string => {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
};

export const getSettlementContext = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmSettlementContextQuery>(req);
  ok(res, await atmCassetteLayoutService.context(query.page, authContext(req)));
};

export const listCassetteLayouts = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmSettlementBankQuery>(req);
  ok(res, await atmCassetteLayoutService.list(query, authContext(req)));
};

export const listLayoutImportRuns = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmSettlementBankQuery>(req);
  ok(res, await atmCassetteLayoutService.runs(query, authContext(req)));
};

export const importLayouts = async (req: Request, res: Response): Promise<void> => {
  const file = (req as Request & { file?: { buffer: Buffer; originalname?: string } }).file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'no workbook was uploaded' },
    ]);
  }
  const parsed = LayoutImportFieldsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map(
        (issue): ApiErrorDetail => ({
          field: `body${issue.path.length > 0 ? '.' + issue.path.join('.') : ''}`,
          code: issue.code.toUpperCase(),
          message: issue.message,
        }),
      ),
    );
  }
  ok(
    res,
    await atmLayoutImportService.run(
      { buffer: file.buffer, fileName: fileNameOf(file.originalname ?? ''), fields: parsed.data },
      authContext(req),
    ),
  );
};

export const getCassetteLayout = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { machineId: string }>(req);
  ok(res, await atmCassetteLayoutService.detail(params.machineId, authContext(req)));
};

export const saveCassetteLayout = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SaveAtmCassetteLayout, never, { machineId: string }>(req);
  ok(res, await atmCassetteLayoutService.save(params.machineId, body, authContext(req)));
};

export const listStandardLoads = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmSettlementBankQuery>(req);
  ok(res, await atmStandardLoadService.list(query, authContext(req)));
};

export const createStandardLoad = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveAtmStandardLoad>(req);
  ok(res, await atmStandardLoadService.create(body, authContext(req)));
};

export const updateStandardLoad = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SaveAtmStandardLoad, never, { id: string }>(req);
  ok(res, await atmStandardLoadService.update(params.id, body, authContext(req)));
};

export const deleteStandardLoad = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, AtmVersionQuery, { id: string }>(req);
  await atmStandardLoadService.remove(params.id, query.version, authContext(req));
  noContent(res);
};

export const getPlanByDay = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmSettlementPlanQuery>(req);
  ok(res, await atmSettlementPlanService.byDay(query, authContext(req)));
};

export const createPlan = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateAtmPlan>(req);
  ok(res, await atmSettlementPlanService.create(body, authContext(req)));
};

export const getPlan = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { planId: string }>(req);
  ok(res, await atmSettlementPlanService.get(params.planId, authContext(req)));
};

export const addPlanLines = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AddAtmPlanLines, never, { planId: string }>(req);
  ok(res, await atmSettlementPlanService.addLines(params.planId, body, authContext(req)));
};

export const addSpareLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AddAtmSpareLine, never, { planId: string }>(req);
  ok(res, await atmSettlementPlanService.addSpare(params.planId, body, authContext(req)));
};

type LineParams = { planId: string; lineId: string };

export const updatePlanLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmPlanLine, never, LineParams>(req);
  ok(
    res,
    await atmSettlementPlanService.updateLine(params.planId, params.lineId, body, authContext(req)),
  );
};

export const deletePlanLine = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, AtmVersionQuery, LineParams>(req);
  await atmSettlementPlanService.deleteLine(
    params.planId,
    params.lineId,
    query.version,
    authContext(req),
  );
  noContent(res);
};

export const issuePlan = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<IssueAtmPlan, never, { planId: string }>(req);
  ok(res, await atmSettlementPlanService.issue(params.planId, body, authContext(req)));
};

export const reopenPlanLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AtmLineReason, never, LineParams>(req);
  ok(
    res,
    await atmSettlementPlanService.reopen(params.planId, params.lineId, body, authContext(req)),
  );
};

export const cancelPlanLine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AtmLineReason, never, LineParams>(req);
  ok(
    res,
    await atmSettlementPlanService.cancel(params.planId, params.lineId, body, authContext(req)),
  );
};

export const recordSpareUse = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AtmSpareUse, never, LineParams>(req);
  ok(
    res,
    await atmSettlementPlanService.spareUse(params.planId, params.lineId, body, authContext(req)),
  );
};

export const printPlan = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AtmSettlementPrint, never, { planId: string }>(req);
  ok(res, await atmSettlementPrintService.print(params.planId, body, authContext(req)));
};
