// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import {
  type CreateEmployee,
  type CreateEmployeeLogin,
  type EmployeeLoginDto,
  type ListEmployeesQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { userService } from '../../../../platform/users';
import { scopeSelector } from '../../../../shared/types';
import { employeeService } from './employee.service';
import { toEmployeeDto } from './employee.mapper';

type IdParam = { id: string };

export const createEmployee = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateEmployee>(req);
  const doc = await employeeService.create(ctx, body, scopeSelector(ctx, 'employee.create'));
  created(res, toEmployeeDto(doc), `/api/v1/hr/employees/${String(doc._id)}`);
};

export const listEmployees = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListEmployeesQuery>(req);
  okPage(res, await employeeService.list(query, scopeSelector(ctx, 'employee.view')), toEmployeeDto);
};

export const getEmployee = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toEmployeeDto(await employeeService.getById(params.id, scopeSelector(ctx, 'employee.view'))));
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
