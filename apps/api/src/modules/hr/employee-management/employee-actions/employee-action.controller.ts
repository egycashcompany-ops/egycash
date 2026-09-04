// Thin HTTP mapping only (ADR-003). Each create endpoint is gated by its permission GROUP at
// the route (F5); the fine-grained rules (promotion-with-salary needs compensation, rehire
// override — D2) are enforced here/in the service from the caller's effective permissions.
import { type Request, type Response } from 'express';
import {
  type ActionOverlapsQuery,
  type CancelEmployeeAction,
  type ChangeEmployeeStatus,
  type CompensationAction,
  type EmploymentAction,
  type ExitAction,
  type ListEmployeeActionsQuery,
  type RehireAction,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { ValidationError } from '../../../../shared/errors';
import { fileService } from '../../../../platform/files';
import { authContext } from '../../../../platform/auth';
import { hasPermission, scopeSelector } from '../../../../shared/types';
import {
  ACTION_GROUP_PERMISSIONS,
  employeeActionService,
  type ActionGroupGrants,
} from './employee-action.service';
import { employeeService, toEmployeeDto } from '../employees';
import { toEmployeeActionDto } from './employee-action.mapper';

type IdParam = { id: string };
type ActionParam = { id: string; actionId: string };

const compVisible = (req: Request): boolean =>
  hasPermission(authContext(req), 'employee.viewCompensation');

/**
 * An ACTION DTO redacts one thing (the salary it carries), but the deprecated status alias answers
 * with a whole EMPLOYEE, which has three gated blocks. Same three keys as the employees controller.
 */
const employeeVisibility = (
  req: Request,
): { compensationVisible: boolean; insuranceVisible: boolean; officerVisible: boolean } => {
  const ctx = authContext(req);
  return {
    compensationVisible: hasPermission(ctx, 'employee.viewCompensation'),
    insuranceVisible: hasPermission(ctx, 'employee.viewInsurance'),
    officerVisible: hasPermission(ctx, 'employee.viewOfficer'),
  };
};

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
  // Cancel follows the ACTION's group — hand the service a scope per held group permission.
  const grants: ActionGroupGrants = {};
  for (const key of ACTION_GROUP_PERMISSIONS) {
    if (hasPermission(ctx, key)) grants[key] = scopeSelector(ctx, key);
  }
  const doc = await employeeActionService.cancel(ctx, params.id, params.actionId, body, grants);
  ok(res, toEmployeeActionDto(doc, { compensationVisible: compVisible(req) }));
};

export const listEmployeeActions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ListEmployeeActionsQuery, IdParam>(req);
  const visible = { compensationVisible: compVisible(req) };
  okPage(
    res,
    await employeeActionService.list(params.id, query, scopeSelector(ctx, 'employee.view')),
    (d) => toEmployeeActionDto(d, visible),
  );
};

/**
 * Upload the document an action will be created WITH (HR3-C).
 *
 * Returns the file so the client has the id to pass to the create endpoint. The entity reference
 * is set by the service, never by the caller — which is what makes the ADR-023 authorizer's answer
 * mean something.
 */
export const attachActionDocument = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  // Scoped by the group the caller actually holds — the route already proved they hold one.
  const key = ACTION_GROUP_PERMISSIONS.find((k) => hasPermission(ctx, k));
  const doc = await employeeActionService.attach(
    ctx,
    params.id,
    { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer },
    scopeSelector(ctx, key ?? 'employee.manageActions'),
  );
  created(res, fileService.toDto(doc), `/api/v1/platform/files/${String(doc._id)}`);
};

/**
 * The overlap warning (C1). Follows `employee.view` like the history it is drawn from — it
 * returns a subset of the scheduled actions that endpoint already returns, with no payloads,
 * so it can disclose nothing the caller could not already read.
 */
export const listActionOverlaps = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, ActionOverlapsQuery, IdParam>(req);
  ok(res, await employeeActionService.overlapsFor(params.id, query.type, scopeSelector(ctx, 'employee.view')));
};

/**
 * DEPRECATED alias over the actions engine — kept one release (frozen design §6). Returns the
 * UPDATED EMPLOYEE (the old endpoint's shape) so existing clients keep working.
 */
export const changeEmployeeStatusAlias = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ChangeEmployeeStatus, never, IdParam>(req);
  await employeeActionService.statusAlias(ctx, params.id, body, scopeSelector(ctx, 'employee.changeStatus'));
  const employee = await employeeService.getById(params.id, scopeSelector(ctx, 'employee.changeStatus'));
  ok(res, toEmployeeDto(employee, employeeVisibility(req)));
};
