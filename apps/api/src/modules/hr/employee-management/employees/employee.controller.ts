// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly. Three blocks of the employee are
// permission-gated and redacted per caller — salary (`employee.viewCompensation`, frozen design
// §7), the social-insurance file (`employee.viewInsurance`) and the officer profile
// (`employee.viewOfficer`) — all resolved by the single `visibility` helper below. The status
// endpoint lives in the employee-actions feature now (deprecated alias).
import { type Request, type Response } from 'express';
import {
  type ChangeEmployeeCode,
  type ChangeEmployeeCodeMeta,
  type CreateEmployee,
  type CreateEmployeeLogin,
  type DirectRegisterEmployee,
  type RegisterExternalEmployee,
  type EmployeeCodeCheckQuery,
  type EmployeeLoginDto,
  type JobTitlePlacementQuery,
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
import { ValidationError } from '../../../../shared/errors';
import { hasPermission, scopeSelector } from '../../../../shared/types';
import { employeeService } from './employee.service';
import { toEmployeeDto, toMyEmployeeSummaryDto, toRehireCheckResultDto } from './employee.mapper';
import { resolvePlacements } from './employee-placement';
import { employeeIdCardService } from './employee-id-card.service';

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

/** «أخر كود كام للموظفين الخارجيين دول» — stated under the code box on the register screen. */
export const getLastExternalEmployeeCode = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await employeeService.lastExternalCode());
};

/** An external person — the code HR typed, their name, and where they sit. */
export const registerEmployeeExternal = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<RegisterExternalEmployee>(req);
  const doc = await employeeService.registerExternal(
    ctx,
    body,
    scopeSelector(ctx, 'employee.registerDirect'),
  );
  const placement = await resolvePlacements([doc]);
  created(
    res,
    toEmployeeDto(doc, visibility(req), placement.for(doc)),
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

/** The register screen's hint under the code: the code holding the highest number. */
export const getLastEmployeeCode = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await employeeService.lastCode());
};

/** A typed code, before it is submitted: the branch it names and whether its number is free. */
export const checkEmployeeCode = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, EmployeeCodeCheckQuery>(req);
  ok(res, await employeeService.checkCode(query.code));
};

/** Per job title, the department and section most of a branch's staff with it work in. */
export const getJobTitlePlacements = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, JobTitlePlacementQuery>(req);
  ok(res, await employeeService.jobTitlePlacements(query.branchId));
};

export const getEmployee = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await employeeService.getById(params.id, scopeSelector(ctx, 'employee.view'));
  const placement = await resolvePlacements([doc]);
  ok(res, toEmployeeDto(doc, visibility(req), placement.for(doc)));
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

/**
 * Change the Employee Code by hand (ADR-017, amended). `meta.loginUsernameChanged` tells the screen
 * whether the employee now signs in with the new code, so HR can say so to them.
 */
export const changeEmployeeCode = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ChangeEmployeeCode, never, IdParam>(req);
  const { doc, loginUsernameChanged } = await employeeService.changeCode(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'employee.changeCode'),
  );
  const meta: ChangeEmployeeCodeMeta = { loginUsernameChanged };
  ok(res, toEmployeeDto(doc, visibility(req), (await resolvePlacements([doc])).for(doc)), meta);
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
/** The employee's National-ID card images, carried over from their applicant file. */
export const getEmployeeNationalIdCard = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    await employeeService.nationalIdCard(ctx, params.id, scopeSelector(ctx, 'employee.view')),
  );
};

export const listSubordinates = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const visible = visibility(req);
  const reports = await employeeService.subordinates(
    params.id,
    scopeSelector(ctx, 'employee.view'),
  );
  const placement = await resolvePlacements(reports);
  ok(
    res,
    reports.map((d) => toEmployeeDto(d, visible, placement.for(d))),
  );
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

/**
 * The welcome page's card for the signed-in person: who they are, where they sit, their birthday.
 *
 * The same token-to-employee lookup as `/me` (and its 404 for a login with no employee behind it),
 * but a much narrower answer: `toMyEmployeeSummaryDto` names every field it carries, so nothing
 * else of the record — no national id, no contact, no salary — can ride along.
 */
export const getMyEmployeeSummary = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const doc = await employeeService.getMine(ctx.userId);
  const placement = await resolvePlacements([doc]);
  ok(res, toMyEmployeeSummaryDto(doc, placement.for(doc)));
};

/**
 * A photo goes out as its BYTES, not the JSON envelope and not a signed URL: an `<img>` cannot
 * carry the bearer token a private picture needs, so the browser fetches the bytes with it and
 * shows an object URL. Private, and not kept by any cache — a replaced or removed photo must not
 * outlive the change.
 */
const sendPhoto = (
  res: Response,
  photo: { buffer: Buffer; mime: string; fileName: string },
): void => {
  res.setHeader('Content-Type', photo.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(photo.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(photo.buffer);
};

/** An employee's photo, for someone who may see the employee — scoped like `GET /:id`. */
export const getEmployeePhoto = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'employee.view');
  sendPhoto(res, await employeeService.readPhoto(ctx, params.id, scope));
};

/** The caller's own photo. The employee comes from the token, like every other `/me`. */
export const getMyEmployeePhoto = async (req: Request, res: Response): Promise<void> => {
  sendPhoto(res, await employeeService.readMyPhoto(authContext(req)));
};

/**
 * Set or replace the photo. Answers with the whole employee, redacted exactly as
 * `PATCH /:id/personal` answers, so the profile updates from the response.
 */
export const uploadEmployeePhoto = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  // A request without the part gets a named 400 rather than a crash on `.buffer`.
  const uploaded = req.file;
  if (uploaded === undefined) {
    const message = 'a photo is required, in a part named "file"';
    throw new ValidationError([{ field: 'file', code: 'REQUIRED', message }], message);
  }
  const doc = await employeeService.setPhoto(
    ctx,
    params.id,
    {
      originalName: uploaded.originalname,
      mime: uploaded.mimetype,
      size: uploaded.size,
      buffer: uploaded.buffer,
    },
    scopeSelector(ctx, 'employee.editPersonal'),
  );
  ok(res, toEmployeeDto(doc, visibility(req), (await resolvePlacements([doc])).for(doc)));
};

/** Remove the photo — idempotent: no photo answers with the employee unchanged. */
export const removeEmployeePhoto = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await employeeService.removePhoto(
    ctx,
    params.id,
    scopeSelector(ctx, 'employee.editPersonal'),
  );
  ok(res, toEmployeeDto(doc, visibility(req), (await resolvePlacements([doc])).for(doc)));
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

/**
 * The company ID card's data, the full national ID among it (see `employee-id-card.ts`). Scoped
 * like a personal-data edit, which is the permission that may print the card.
 */
export const getEmployeeIdCard = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'employee.editPersonal');
  const doc = await employeeService.getById(params.id, scope);
  const placement = await resolvePlacements([doc]);
  ok(
    res,
    await employeeIdCardService.cardData(ctx, params.id, scope, placement.for(doc).jobTitle, doc),
  );
};

/** One print: recorded, and the card waits for its handover. It is not counted as a card. */
export const recordEmployeeIdCardPrint = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  created(
    res,
    await employeeIdCardService.recordPrint(
      ctx,
      params.id,
      scopeSelector(ctx, 'employee.editPersonal'),
    ),
    `/api/v1/hr/employees/${params.id}/id-card/prints`,
  );
};

/** The receipt for the waiting card was printed — the handover's second step, kept on the employee. */
export const recordEmployeeIdCardReceipt = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    await employeeIdCardService.recordReceipt(
      ctx,
      params.id,
      scopeSelector(ctx, 'employee.editPersonal'),
    ),
  );
};

/** HR confirms the employee signed the receipt and took the card — the only thing that counts a card. */
export const confirmEmployeeIdCardHandover = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    await employeeIdCardService.confirmHandover(
      ctx,
      params.id,
      scopeSelector(ctx, 'employee.editPersonal'),
    ),
  );
};

/** Every card printed for the employee, newest first. */
export const listEmployeeIdCardPrints = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await employeeIdCardService.history(params.id, scopeSelector(ctx, 'employee.view')));
};
