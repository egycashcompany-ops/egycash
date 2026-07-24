// Thin HTTP mapping only (ADR-003). Each create endpoint is gated by its permission GROUP at
// the route (F5); the fine-grained rules (promotion-with-salary needs compensation, rehire
// override — D2) are enforced here/in the service from the caller's effective permissions.
import { type Request, type Response } from 'express';
import {
  type CancelEmployeeAction,
  type ChangeEmployeeStatus,
  type CompensationAction,
  type EmploymentAction,
  type ExitAction,
  type ListEmployeeActionsQuery,
  type RehireAction,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { hasPermission, scopeSelector } from '../../../../shared/types';
import { employeeActionService } from './employee-action.service';
import { toEmployeeActionDto } from './employee-action.mapper';

type IdParam = { id: string };
type ActionParam = { id: string; actionId: string };

const compVisible = (req: Request): boolean =>
  hasPermission(authContext(req), 'employee.viewCompensation');

export const createEmploymentAction = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<EmploymentAction, never, IdParam>(req);
  const doc = await employeeActionService.createEmploymentAction(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.manageActions'),
    { canManageCompensation: hasPermission(ctx, 'employee.manageCompensation') },
  );
  created(res, toEmployeeActionDto(doc, { compensationVisible: compVisible(req) }),
    `/api/v1/hr/employees/${params.id}/actions/${String(doc._id)}`);
};

export const createCompensationAction = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CompensationAction, never, IdParam>(req);
  const doc = await employeeActionService.createCompensationAction(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.manageCompensation'),
  );
  created(res, toEmployeeActionDto(doc, { compensationVisible: compVisible(req) }),
    `/api/v1/hr/employees/${params.id}/actions/${String(doc._id)}`);
};

export const createExitAction = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ExitAction, never, IdParam>(req);
  const doc = await employeeActionService.createExitAction(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.exit'),
  );
  created(res, toEmployeeActionDto(doc, { compensationVisible: compVisible(req) }),
    `/api/v1/hr/employees/${params.id}/actions/${String(doc._id)}`);
};

export const createRehireAction = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RehireAction, never, IdParam>(req);
  const doc = await employeeActionService.createRehireAction(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.rehire'),
    { canOverrideRehire: hasPermission(ctx, 'employee.rehireOverride') },
  );
  created(res, toEmployeeActionDto(doc, { compensationVisible: compVisible(req) }),
    `/api/v1/hr/employees/${params.id}/actions/${String(doc._id)}`);
};

export const cancelEmployeeAction = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelEmployeeAction, never, ActionParam>(req);
  const doc = await employeeActionService.cancel(
    ctx,
    params.id,
    params.actionId,
    body,
    scopeSelector(ctx, 'employee.manageActions'),
  );
  ok(res, toEmployeeActionDto(doc, { compensationVisible: compVisible(req) }));
};

export const listEmployeeActions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ListEmployeeActionsQuery, IdParam>(req);
  const visible = compVisible(req);
  okPage(
    res,
    await employeeActionService.list(params.id, query, scopeSelector(ctx, 'employee.view')),
    (d) => toEmployeeActionDto(d, { compensationVisible: visible }),
  );
};

/** DEPRECATED alias over the actions engine — kept one release (frozen design §6). */
export const changeEmployeeStatusAlias = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ChangeEmployeeStatus, never, IdParam>(req);
  const doc = await employeeActionService.statusAlias(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.changeStatus'),
  );
  ok(res, toEmployeeActionDto(doc, { compensationVisible: compVisible(req) }));
};
