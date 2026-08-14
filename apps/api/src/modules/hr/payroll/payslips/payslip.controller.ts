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

/**
 * One employee's payslips, across every run (P-HR-20).
 *
 * The mirror of the run's list: that one asks "who was paid this month?", this asks "what has this
 * person been paid?". Same documents, same key, and neither recomputes anything — a payslip is a
 * frozen copy of what somebody was paid, and reading it a second way must not change it.
 */
export const listEmployeePayslips = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ListPayslipsQuery, IdParam>(req);
  okPage(
    res,
    await payslipService.listForEmployee(
      params.id,
      query,
      scopeSelector(ctx, 'employee.viewCompensation'),
    ),
    (doc) => payslipService.toDto(doc),
  );
};

/**
 * The caller's own payslips (PY-11).
 *
 * Whatever `employeeId` arrived is DROPPED — `/me` answers for the caller and nobody else, the
 * same way `/days/me` does.
 */
export const listMyPayslips = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListPayslipsQuery, never>(req);
  const own = {
    page: query.page,
    pageSize: query.pageSize,
    sortDir: query.sortDir,
    ...(query.sortBy === undefined ? {} : { sortBy: query.sortBy }),
    ...(query.period === undefined ? {} : { period: query.period }),
  };
  okPage(res, await payslipService.listMine(String(ctx.userId), own), (doc) =>
    payslipService.toDto(doc),
  );
};

export const getMyPayslip = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, payslipService.toDto(await payslipService.getMine(String(ctx.userId), params.id)));
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
