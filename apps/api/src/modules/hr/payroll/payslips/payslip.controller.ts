// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListPayslipsQuery } from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { payslipService } from './payslip.service';

type RunIdParam = { id: string };
type IdParam = { id: string };

/** Issues every payslip the run is owed. Idempotent: a second pass reports, it does not restate. */
export const generatePayslips = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, RunIdParam>(req);
  const result = await payslipService.generateFor(params.id, ctx.userId);
  created(res, result, `/api/v1/hr/payroll/runs/${params.id}/payslips`);
};

export const listRunPayslips = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ListPayslipsQuery, RunIdParam>(req);
  okPage(
    res,
    await payslipService.listForRun(
      params.id,
      query,
      scopeSelector(ctx, 'employee.viewCompensation'),
    ),
    (doc) => payslipService.toDto(doc),
  );
};

export const getPayslip = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    payslipService.toDto(
      await payslipService.getById(params.id, scopeSelector(ctx, 'employee.viewCompensation')),
    ),
  );
};
