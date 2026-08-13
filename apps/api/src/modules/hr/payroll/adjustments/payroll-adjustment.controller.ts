// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CancelPayrollAdjustment,
  type CreatePayrollAdjustment,
  type DecidePayrollAdjustment,
  type ListPayrollAdjustmentsQuery,
  type PayrollAdjustmentDto,
  type SubmitPayrollAdjustment,
  type UpdatePayrollAdjustment,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { ValidationError } from '../../../../shared/errors';
import { authContext } from '../../../../platform/auth';
import { fileService } from '../../../../platform/files';
import { scopeSelector } from '../../../../shared/types';
import { employeeLabelMap, labelFields } from '../../shared/employee-labels';
import { payrollAdjustmentService } from './payroll-adjustment.service';
import { toPayrollAdjustmentDto } from './payroll-adjustment.mapper';
import { type PayrollAdjustmentDoc } from './payroll-adjustment.model';

type IdParam = { id: string };
type AdjustmentParam = { id: string; adjustmentId: string };

/** One row still needs its catalog label resolved — the same call the list makes for a page. */
const one = async (doc: PayrollAdjustmentDoc) =>
  toPayrollAdjustmentDto(doc, await payrollAdjustmentService.payItemsFor([doc]));

export const createAdjustment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CreatePayrollAdjustment, never, IdParam>(req);
  const doc = await payrollAdjustmentService.create(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'payrollAdjustment.create'),
  );
  created(res, await one(doc), `/api/v1/hr/employees/${params.id}/adjustments/${String(doc._id)}`);
};

export const updateAdjustment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdatePayrollAdjustment, never, AdjustmentParam>(req);
  const doc = await payrollAdjustmentService.update(
    ctx,
    params.id,
    params.adjustmentId,
    body,
    scopeSelector(ctx, 'payrollAdjustment.create'),
  );
  ok(res, await one(doc));
};

export const submitAdjustment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SubmitPayrollAdjustment, never, AdjustmentParam>(req);
  const doc = await payrollAdjustmentService.submit(
    ctx,
    params.id,
    params.adjustmentId,
    body.version,
    scopeSelector(ctx, 'payrollAdjustment.create'),
  );
  ok(res, await one(doc));
};

/** The second person's decision (D1) — under its own key, never the creator's. */
export const decideAdjustment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecidePayrollAdjustment, never, AdjustmentParam>(req);
  const doc = await payrollAdjustmentService.decide(
    ctx,
    params.id,
    params.adjustmentId,
    body,
    scopeSelector(ctx, 'payrollAdjustment.approve'),
  );
  ok(res, await one(doc));
};

export const cancelAdjustment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelPayrollAdjustment, never, AdjustmentParam>(req);
  const doc = await payrollAdjustmentService.cancel(
    ctx,
    params.id,
    params.adjustmentId,
    body,
    scopeSelector(ctx, 'payrollAdjustment.create'),
  );
  ok(res, await one(doc));
};

export const listEmployeeAdjustments = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ListPayrollAdjustmentsQuery, IdParam>(req);
  const page = await payrollAdjustmentService.listForEmployee(
    params.id,
    query,
    scopeSelector(ctx, 'payrollAdjustment.view'),
  );
  const items = await payrollAdjustmentService.payItemsFor(page.items);
  okPage(res, page, (doc) => toPayrollAdjustmentDto(doc, items));
};

/**
 * The organization-wide read — the approval queue lives on this one, filtered by status.
 *
 * This one enriches the employee's code and name (P-HR-06 / D7), because it is the ONLY adjustment
 * read whose caller does not already know whose row it is looking at: a queue of decisions about
 * many people is unusable as a list of ids. The employee-scoped read above deliberately does not,
 * and neither stores the labels — a name corrected tomorrow must not leave a stale copy behind.
 */
export const listAdjustments = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListPayrollAdjustmentsQuery>(req);
  const page = await payrollAdjustmentService.list(
    query,
    scopeSelector(ctx, 'payrollAdjustment.view'),
  );
  const items = await payrollAdjustmentService.payItemsFor(page.items);
  const labels = await employeeLabelMap(page.items.map((doc) => String(doc.employeeId)));
  okPage(
    res,
    page,
    (doc): PayrollAdjustmentDto => ({
      ...toPayrollAdjustmentDto(doc, items),
      ...labelFields(labels, String(doc.employeeId)),
    }),
  );
};

/** The supporting document, uploaded before the entry that names it (the HR3-C pattern). */
export const attachAdjustmentDocument = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  const doc = await payrollAdjustmentService.attach(
    ctx,
    params.id,
    { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer },
    scopeSelector(ctx, 'payrollAdjustment.create'),
  );
  created(res, fileService.toDto(doc), `/api/v1/platform/files/${String(doc._id)}`);
};
