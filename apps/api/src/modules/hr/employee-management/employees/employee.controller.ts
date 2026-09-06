// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly. Three blocks of the employee are
// permission-gated and redacted per caller — salary (`employee.viewCompensation`, frozen design
// §7), the social-insurance file (`employee.viewInsurance`) and the officer profile
// (`employee.viewOfficer`) — all resolved by the single `visibility` helper below. The status
// endpoint lives in the employee-actions feature now (deprecated alias).
import { type Request, type Response } from 'express';
import {
  type CreateEmployee,
  type CreateEmployeeLogin,
  type DirectRegisterEmployee,
  type EmployeeLoginDto,
  type LinkEmployeeUser,
  type ListEmployeesQuery,
  type RehireCheckQuery,
  type UpdateEmployeeInsurance,
  type UpdateEmployeeOfficer,
  type UpdateEmployeePersonal,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { userService } from '../../../../platform/users';
import { hasPermission, scopeSelector } from '../../../../shared/types';
import { employeeService } from './employee.service';
import { toEmployeeDto, toRehireCheckResultDto } from './employee.mapper';
import { resolvePlacements } from './employee-placement';

type IdParam = { id: string };

/**
 * Which permission-gated blocks this caller may actually see. One helper rather than three, so a
 * fourth gated block is added in one place and cannot be forgotten at one of the nine call sites
 * below — forgetting it would not fail a build, it would quietly leak a wage bracket.
 */
const visibility = (
  req: Request,
): { compensationVisible: boolean; insuranceVisible: boolean; officerVisible: boolean } => {
  const ctx = authContext(req);
  return {
    compensationVisible: hasPermission(ctx, 'employee.viewCompensation'),
    insuranceVisible: hasPermission(ctx, 'employee.viewInsurance'),
    officerVisible: hasPermission(ctx, 'employee.viewOfficer'),
  };
};

export const createEmployee = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateEmployee>(req);
  const { doc, provisionedLogin } = await employeeService.create(
    ctx,
    body,
    scopeSelector(ctx, 'employee.create'),
  );
  const placement = await resolvePlacements([doc]);
  created(
    res,
    { ...toEmployeeDto(doc, visibility(req), placement.for(doc)), provisionedLogin },
    `/api/v1/hr/employees/${String(doc._id)}`,
  );
};

/** Direct Registration (D4) — go-live workforce onboarding / walk-in hire. */
export const registerEmployeeDirect = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<DirectRegisterEmployee>(req);
  const { doc, provisionedLogin } = await employeeService.registerDirect(
    ctx,
    body,
    scopeSelector(ctx, 'employee.registerDirect'),
  );
  const placement = await resolvePlacements([doc]);
  created(
    res,
    { ...toEmployeeDto(doc, visibility(req), placement.for(doc)), provisionedLogin },
    `/api/v1/hr/employees/${String(doc._id)}`,
  );
};

export const listEmployees = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListEmployeesQuery>(req);
  const visible = visibility(req);
  const page = await employeeService.list(query, scopeSelector(ctx, 'employee.view'));
  // Names for the whole page in one read per catalogue — never one lookup per row.
  const placement = await resolvePlacements(page.items);
  okPage(res, page, (d) => toEmployeeDto(d, visible, placement.for(d)));
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
  const doc = await employeeService.getById(params.id, scopeSelector(ctx, 'employee.view'));
  const placement = await resolvePlacements([doc]);
  ok(
    res,
    toEmployeeDto(
      doc,
      visibility(req),
      placement.for(doc),
    ),
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
  ok(res, toEmployeeDto(doc, visibility(req), (await resolvePlacements([doc])).for(doc)));
};

/** Replace the social-insurance file — an audited update, not a personnel action. */
export const updateEmployeeInsurance = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateEmployeeInsurance, never, IdParam>(req);
  const doc = await employeeService.updateInsurance(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.manageInsurance'),
  );
  ok(res, toEmployeeDto(doc, visibility(req), (await resolvePlacements([doc])).for(doc)));
};

/** Replace the officer / armed-security profile — an audited update, not a personnel action. */
export const updateEmployeeOfficer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateEmployeeOfficer, never, IdParam>(req);
  const doc = await employeeService.updateOfficer(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.manageOfficer'),
  );
  ok(res, toEmployeeDto(doc, visibility(req), (await resolvePlacements([doc])).for(doc)));
};

/** Employed direct reports of this employee (manager tree seed). */
export const listSubordinates = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const visible = visibility(req);
  const reports = await employeeService.subordinates(params.id, scopeSelector(ctx, 'employee.view'));
  const placement = await resolvePlacements(reports);
  ok(res, reports.map((d) => toEmployeeDto(d, visible, placement.for(d))));
};

/** Composed profile timeline: file milestones + personnel actions + audited personal edits. */
/**
 * The caller's OWN employee record — the self-service profile (ESS).
 *
 * `authenticate` and no `authorize`, like every other `/me` in the platform: the id is not supplied
 * by the caller, it comes from the token, so there is no record to be authorized ONTO. An employee
 * holds no `employee.view`, and requiring it would either lock them out of their own file or hand
 * them the whole registry.
 *
 * REDACTION IS THE SAME RULE AS EVERYWHERE ELSE, not a second one. The DTO goes through
 * `visibility(req)`, which reads `employee.viewCompensation` / `viewInsurance` / `viewOfficer` off
 * the caller — keys an ordinary employee does not hold — so salary, the insurance file and the
 * officer profile come back redacted with their `*Visible` flags false. A manager who DOES hold
 * them sees their own of those, which is correct and needed no exception either.
 *
 * 404 when the login is not linked to an employee: a platform account that is not one of us has no
 * employee file, and saying so is better than an empty one.
 */
export const getMyEmployeeProfile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const doc = await employeeService.getMine(ctx.userId);
  const placement = await resolvePlacements([doc]);
  ok(res, toEmployeeDto(doc, visibility(req), placement.for(doc)));
};

export const getEmployeeTimeline = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await employeeService.timeline(params.id, scopeSelector(ctx, 'employee.view')));
};

/**
 * E1 — attach an existing login to this employee. Two scopes are resolved because two records are
 * being changed: the employee under `employee.view`, the account under `user.edit`.
 */
export const linkEmployeeUser = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<LinkEmployeeUser, never, IdParam>(req);
  const doc = await employeeService.linkUser(
    ctx,
    params.id,
    body.userId,
    scopeSelector(ctx, 'employee.view'),
    scopeSelector(ctx, 'user.edit'),
  );
  ok(res, toEmployeeDto(doc, visibility(req), (await resolvePlacements([doc])).for(doc)));
};

export const unlinkEmployeeUser = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await employeeService.unlinkUser(
    ctx,
    params.id,
    scopeSelector(ctx, 'employee.view'),
    scopeSelector(ctx, 'user.edit'),
  );
  ok(res, toEmployeeDto(doc, visibility(req), (await resolvePlacements([doc])).for(doc)));
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
