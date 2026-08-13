// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type AccelerateEmployeeLoan,
  type CancelEmployeeLoan,
  type CreateEmployeeLoan,
  type DecideEmployeeLoan,
  type DisburseEmployeeLoan,
  type EmployeeLoanDto,
  type ListEmployeeLoansQuery,
  type RescheduleEmployeeLoan,
  type SettleEmployeeLoanExternally,
  type SubmitEmployeeLoan,
  type UpdateEmployeeLoan,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { ValidationError } from '../../../shared/errors';
import { authContext } from '../../../platform/auth';
import { fileService } from '../../../platform/files';
import { scopeSelector } from '../../../shared/types';
import { employeeLabelMap, labelFields } from '../shared/employee-labels';
import { employeeLoanService } from './employee-loan.service';
import {
  toEmployeeLoanDetailDto,
  toEmployeeLoanDto,
} from './employee-loan.mapper';

type IdParam = { id: string };
type LoanParam = { id: string; loanId: string };

export const createLoan = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CreateEmployeeLoan, never, IdParam>(req);
  const doc = await employeeLoanService.create(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employeeLoan.create'),
  );
  created(res, toEmployeeLoanDto(doc), `/api/v1/hr/employees/${params.id}/loans/${String(doc._id)}`);
};

export const updateLoan = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateEmployeeLoan, never, LoanParam>(req);
  const doc = await employeeLoanService.update(
    ctx,
    params.id,
    params.loanId,
    body,
    scopeSelector(ctx, 'employeeLoan.create'),
  );
  ok(res, toEmployeeLoanDto(doc));
};

export const submitLoan = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SubmitEmployeeLoan, never, LoanParam>(req);
  const doc = await employeeLoanService.submit(
    ctx,
    params.id,
    params.loanId,
    body,
    scopeSelector(ctx, 'employeeLoan.create'),
  );
  ok(res, toEmployeeLoanDto(doc));
};

/** The second person's decision (D2) — under its own key, never the submitter's. */
export const decideLoan = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideEmployeeLoan, never, LoanParam>(req);
  const doc = await employeeLoanService.decide(
    ctx,
    params.id,
    params.loanId,
    body,
    scopeSelector(ctx, 'employeeLoan.approve'),
  );
  ok(res, toEmployeeLoanDto(doc));
};

/** Recording that the money changed hands elsewhere — and generating the schedule (D5). */
export const disburseLoan = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DisburseEmployeeLoan, never, LoanParam>(req);
  const doc = await employeeLoanService.disburse(
    ctx,
    params.id,
    params.loanId,
    body,
    scopeSelector(ctx, 'employeeLoan.approve'),
  );
  ok(res, toEmployeeLoanDto(doc));
};

export const cancelLoan = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelEmployeeLoan, never, LoanParam>(req);
  const doc = await employeeLoanService.cancel(
    ctx,
    params.id,
    params.loanId,
    body,
    scopeSelector(ctx, 'employeeLoan.create'),
  );
  ok(res, toEmployeeLoanDto(doc));
};

export const rescheduleLoan = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RescheduleEmployeeLoan, never, LoanParam>(req);
  await employeeLoanService.reschedule(
    ctx,
    params.id,
    params.loanId,
    body,
    scopeSelector(ctx, 'employeeLoan.approve'),
  );
  await sendDetail(req, res, params);
};

/** D7-2 — pay more this month, and finish earlier for it (P-HR-05-B). */
export const accelerateLoan = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AccelerateEmployeeLoan, never, LoanParam>(req);
  await employeeLoanService.accelerate(
    ctx,
    params.id,
    params.loanId,
    body,
    scopeSelector(ctx, 'employeeLoan.approve'),
  );
  await sendDetail(req, res, params);
};

/** Both schedule-rewriting operations answer with the schedule they produced. */
const sendDetail = async (req: Request, res: Response, params: LoanParam): Promise<void> => {
  const ctx = authContext(req);
  const detail = await employeeLoanService.detail(
    params.id,
    params.loanId,
    scopeSelector(ctx, 'employeeLoan.view'),
  );
  ok(res, toEmployeeLoanDetailDto(detail.loan, detail.installments, detail.repayments));
};

export const settleLoanExternally = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SettleEmployeeLoanExternally, never, LoanParam>(req);
  const doc = await employeeLoanService.settleExternally(
    ctx,
    params.id,
    params.loanId,
    body,
    scopeSelector(ctx, 'employeeLoan.approve'),
  );
  ok(res, toEmployeeLoanDto(doc));
};

export const getLoan = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, LoanParam>(req);
  await sendDetail(req, res, params);
};

/** The employee's own loans, each with its schedule — one query for the page, not one per row. */
export const listEmployeeLoans = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ListEmployeeLoansQuery, IdParam>(req);
  const page = await employeeLoanService.listForEmployee(
    params.id,
    query,
    scopeSelector(ctx, 'employeeLoan.view'),
  );
  const children = await employeeLoanService.childrenFor(page.items);
  okPage(res, page, (doc) =>
    toEmployeeLoanDetailDto(
      doc,
      children.installments.get(String(doc._id)) ?? [],
      children.repayments.get(String(doc._id)) ?? [],
    ),
  );
};

/**
 * The organization-wide read — the approval queue lives on this one, filtered by status.
 *
 * It enriches the employee's code and name (P-HR-06 / D7): unlike the tab above, this caller is
 * looking at many people at once and has no profile to take the name from. One batch fetch per
 * page, and nothing is stored on the loan — a debt is a decision about somebody who still exists,
 * so the label is looked up at read time rather than copied and left to go stale.
 */
export const listLoans = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListEmployeeLoansQuery>(req);
  const page = await employeeLoanService.list(query, scopeSelector(ctx, 'employeeLoan.view'));
  const labels = await employeeLabelMap(page.items.map((doc) => String(doc.employeeId)));
  okPage(
    res,
    page,
    (doc): EmployeeLoanDto => ({
      ...toEmployeeLoanDto(doc),
      ...labelFields(labels, String(doc.employeeId)),
    }),
  );
};

/** The supporting document, uploaded before the request that names it (the HR3-C pattern). */
export const attachLoanDocument = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  const doc = await employeeLoanService.attach(
    ctx,
    params.id,
    { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer },
    scopeSelector(ctx, 'employeeLoan.create'),
  );
  created(res, fileService.toDto(doc), `/api/v1/platform/files/${String(doc._id)}`);
};
