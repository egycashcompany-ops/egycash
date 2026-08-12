// Thin HTTP mapping only (ADR-003).
//
// The scope handed to the service is the COMPENSATION scope of the key the route authorized —
// `employee.viewCompensation` to read, `employee.manageCompensation` to write — so these rows are
// reachable exactly as far as the caller's compensation reach already goes.
import { type Request, type Response } from 'express';
import {
  type CreateEmployeePayItem,
  type ListEmployeePayItemsQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { employeePayItemService } from './employee-pay-item.service';

type EmployeeParam = { employeeId: string };
type ItemParam = { employeeId: string; id: string };

export const listEmployeePayItems = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ListEmployeePayItemsQuery, EmployeeParam>(req);
  const page = await employeePayItemService.list(
    params.employeeId,
    query,
    scopeSelector(ctx, 'employee.viewCompensation'),
  );
  const labels = await employeePayItemService.labelsFor(page.items);
  okPage(res, page, (doc) => employeePayItemService.toDto(doc, labels));
};

export const createEmployeePayItem = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CreateEmployeePayItem, never, EmployeeParam>(req);
  const doc = await employeePayItemService.create(
    params.employeeId,
    body,
    ctx.userId,
    scopeSelector(ctx, 'employee.manageCompensation'),
  );
  const labels = await employeePayItemService.labelsFor([doc]);
  created(
    res,
    employeePayItemService.toDto(doc, labels),
    `/api/v1/hr/employees/${params.employeeId}/pay-items/${String(doc._id)}`,
  );
};

/**
 * Always 200 with the OUTCOME, never a bare 204: "removed" and "ended" are different facts about
 * an employee's compensation history, and the screen has to be able to say which one happened.
 */
export const removeEmployeePayItem = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, ItemParam>(req);
  const { outcome, doc } = await employeePayItemService.remove(
    params.employeeId,
    params.id,
    ctx.userId,
    scopeSelector(ctx, 'employee.manageCompensation'),
  );
  const labels = doc === null ? new Map() : await employeePayItemService.labelsFor([doc]);
  ok(res, {
    outcome,
    item: doc === null ? null : employeePayItemService.toDto(doc, labels),
  });
};
