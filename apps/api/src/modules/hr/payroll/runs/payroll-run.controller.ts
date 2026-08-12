// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CancelPayrollRun,
  type CreatePayrollRun,
  type FreezePayrollRun,
  type ListPayrollRunsQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { payrollRunService } from './payroll-run.service';

type IdParam = { id: string };

export const listPayrollRuns = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListPayrollRunsQuery, never>(req);
  okPage(res, await payrollRunService.list(query), (doc) => payrollRunService.toDto(doc));
};

export const getPayrollRun = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, payrollRunService.toDto(await payrollRunService.getById(params.id)));
};

export const createPayrollRun = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreatePayrollRun, never, never>(req);
  const doc = await payrollRunService.create(body, ctx.userId);
  created(res, payrollRunService.toDto(doc), `/api/v1/hr/payroll/runs/${String(doc._id)}`);
};

/** The irreversible one. Everything is checked before a single fact is pinned. */
export const freezePayrollRun = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<FreezePayrollRun, never, IdParam>(req);
  ok(res, payrollRunService.toDto(await payrollRunService.freeze(params.id, body.version, ctx.userId)));
};

export const cancelPayrollRun = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelPayrollRun, never, IdParam>(req);
  ok(
    res,
    payrollRunService.toDto(
      await payrollRunService.cancel(params.id, body.reason, body.version, ctx.userId),
    ),
  );
};

/** The frozen leave answer PY-5 will price against — readable now so a freeze can be inspected. */
export const getPayrollRunLeave = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const rows = await payrollRunService.snapshotFor(params.id);
  ok(res, rows.map((row) => payrollRunService.snapshotToDto(row)));
};
