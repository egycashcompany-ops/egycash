// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly. Compensation visibility
// (salary redaction) keys off `employee.viewCompensation` (frozen design §7); the status
// endpoint lives in the employee-actions feature now (deprecated alias).
import { type Request, type Response } from 'express';
import {
  type CreateEmployee,
  type CreateEmployeeLogin,
  type DirectRegisterEmployee,
  type EmployeeLoginDto,
  type ListEmployeesQuery,
  type RehireCheckQuery,
  type UpdateEmployeePersonal,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { userService } from '../../../../platform/users';
import { hasPermission, scopeSelector } from '../../../../shared/types';
import { employeeService } from './employee.service';
import { toEmployeeDto, toRehireCheckResultDto } from './employee.mapper';

type IdParam = { id: string };

const compVisible = (req: Request): boolean =>
  hasPermission(authContext(req), 'employee.viewCompensation');

export const createEmployee = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateEmployee>(req);
  const doc = await employeeService.create(ctx, body, scopeSelector(ctx, 'employee.create'));
  created(
    res,
    toEmployeeDto(doc, { compensationVisible: compVisible(req) }),
    `/api/v1/hr/employees/${String(doc._id)}`,
  );
};

/** Direct Registration (D4) — go-live workforce onboarding / walk-in hire. */
export const registerEmployeeDirect = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<DirectRegisterEmployee>(req);
  const doc = await employeeService.registerDirect(ctx, body, scopeSelector(ctx, 'employee.registerDirect'));
  created(
    res,
    toEmployeeDto(doc, { compensationVisible: compVisible(req) }),
    `/api/v1/hr/employees/${String(doc._id)}`,
  );
};

export const listEmployees = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListEmployeesQuery>(req);
  const visible = compVisible(req);
  okPage(res, await employeeService.list(query, scopeSelector(ctx, 'employee.view')), (d) =>
    toEmployeeDto(d, { compensationVisible: visible }),
  );
};

/** Exited-employee match for a national id — the Rehire prompt / duplicate guard (F2). */
export const rehireCheck = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, RehireCheckQuery>(req);
  const match = await employeeService.rehireCheck(query.nationalId);
  ok(res, match === null ? null : toRehireCheckResultDto(match));
};

export const getEmployee = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    toEmployeeDto(await employeeService.getById(params.id, scopeSelector(ctx, 'employee.view')), {
      compensationVisible: compVisible(req),
    }),
  );
};

/** Post-hire personal-data edits — plain audited updates, not personnel actions (I4). */
export const updateEmployeePersonal = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateEmployeePersonal, never, IdParam>(req);
  const doc = await employeeService.updatePersonal(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.editPersonal'),
  );
  ok(res, toEmployeeDto(doc, { compensationVisible: compVisible(req) }));
};

/** Employed direct reports of this employee (manager tree seed). */
export const listSubordinates = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const visible = compVisible(req);
  const reports = await employeeService.subordinates(params.id, scopeSelector(ctx, 'employee.view'));
  ok(res, reports.map((d) => toEmployeeDto(d, { compensationVisible: visible })));
};

/** Composed profile timeline: file milestones + personnel actions + audited personal edits. */
export const getEmployeeTimeline = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await employeeService.timeline(params.id, scopeSelector(ctx, 'employee.view')));
};

/** Create the login account for an employee (Employee ← one User, ADR-017). Gated by `user.create`. */
export const createEmployeeLogin = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CreateEmployeeLogin, never, IdParam>(req);
  const { user, activationToken, employeeCode } = await employeeService.createLogin(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.view'),
  );
  const payload: EmployeeLoginDto = {
    user: userService.toDto(user),
    activationToken,
    employeeCode,
  };
  created(res, payload, `/api/v1/platform/users/${String(user._id)}`);
};
