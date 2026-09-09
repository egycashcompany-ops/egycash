// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the module
// never imports infrastructure directly (Module Structure §1). Literal paths (`/direct`,
// `/rehire-check`) are declared before `/:id`. The status endpoint moved to the
// employee-actions feature (deprecated alias over the engine).
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createEmployee,
  createEmployeeLogin,
  getEmployee,
  getMyEmployeeProfile,
  getEmployeeTimeline,
  linkEmployeeUser,
  listEmployees,
  listSubordinates,
  registerEmployeeDirect,
  rehireCheck,
  unlinkEmployeeUser,
  updateEmployeeInsurance,
  updateEmployeeOfficer,
  updateEmployeePersonal,
} from './employee.controller';
import {
  CreateEmployeeLoginSchema,
  CreateEmployeeSchema,
  DirectRegisterEmployeeSchema,
  EmployeeIdParamSchema,
  LinkEmployeeUserSchema,
  ListEmployeesQuerySchema,
  RehireCheckQuerySchema,
  UpdateEmployeeInsuranceSchema,
  UpdateEmployeeOfficerSchema,
  UpdateEmployeePersonalSchema,
} from './employee.validation';
import { importEmployeeRoster, ROSTER_MAX_MB } from './employee-roster-import';

/**
 * The workbook, held in memory rather than spooled to disk.
 *
 * It is read once, parsed into rows and dropped — writing a file with two thousand people's national
 * ids onto the server's disk to read it back a line later would leave a copy of the roster lying
 * around for no gain.
 */
const rosterUpload = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ROSTER_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.VALIDATION_FAILED, 422, `File exceeds the ${ROSTER_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

export const buildEmployeesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('employee.view'),
    validate({ query: ListEmployeesQuerySchema }),
    asyncHandler(listEmployees),
  );
  router.post(
    '/',
    authenticate,
    authorize('employee.create'),
    validate({ body: CreateEmployeeSchema }),
    asyncHandler(createEmployee),
  );
  /**
   * The employees screen's upload button. `apply=true` writes; anything else previews.
   *
   * Declared BEFORE `/direct` and `/:id` for the usual reason — `import` must never be parsed as an
   * employee id — and gated on its own key: one upload adds people, rewrites personal data and moves
   * staff across the whole registry, which is a different amount of authority from onboarding one
   * walk-in hire.
   */
  router.post(
    '/import',
    authenticate,
    authorize('employee.importRoster'),
    rosterUpload(),
    asyncHandler(importEmployeeRoster),
  );
  // Direct Registration (D4) — go-live onboarding / walk-in hire (no recruitment pipeline).
  router.post(
    '/direct',
    authenticate,
    authorize('employee.registerDirect'),
    validate({ body: DirectRegisterEmployeeSchema }),
    asyncHandler(registerEmployeeDirect),
  );
  // Exited-employee match by national id — powers the Rehire prompt (declared before /:id).
  /**
   * The caller's own file (ESS). Declared BEFORE `/:id` so `me` is never parsed as an employee id —
   * the same ordering every other `/me` route in the platform is declared with.
   *
   * `authenticate` only: the id comes from the token, so there is nothing to authorize onto, and
   * an employee holds no `employee.view`. What the DTO shows is still decided by the caller's own
   * permissions — see `getMyEmployeeProfile`.
   */
  router.get('/me', authenticate, asyncHandler(getMyEmployeeProfile));
  router.get(
    '/rehire-check',
    authenticate,
    authorize('employee.view'),
    validate({ query: RehireCheckQuerySchema }),
    asyncHandler(rehireCheck),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployee),
  );
  // Post-hire personal-data edits (plain audited updates — frozen design I4).
  router.patch(
    '/:id/personal',
    authenticate,
    authorize('employee.editPersonal'),
    validate({ body: UpdateEmployeePersonalSchema, params: EmployeeIdParamSchema }),
    asyncHandler(updateEmployeePersonal),
  );
  // The social-insurance file and the officer profile: each replaced whole, each behind its own
  // manage permission. Neither is a personnel action — the actions engine's vocabulary is closed,
  // and re-filing an insurance number promotes nobody.
  router.patch(
    '/:id/insurance',
    authenticate,
    authorize('employee.manageInsurance'),
    validate({ body: UpdateEmployeeInsuranceSchema, params: EmployeeIdParamSchema }),
    asyncHandler(updateEmployeeInsurance),
  );
  router.patch(
    '/:id/officer',
    authenticate,
    authorize('employee.manageOfficer'),
    validate({ body: UpdateEmployeeOfficerSchema, params: EmployeeIdParamSchema }),
    asyncHandler(updateEmployeeOfficer),
  );
  // Employed direct reports (manager tree seed).
  router.get(
    '/:id/subordinates',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(listSubordinates),
  );
  // Composed profile timeline (file milestones + actions + audited personal edits).
  router.get(
    '/:id/timeline',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeeTimeline),
  );
  // Create the login account for an employee (Employee ← one User, ADR-017).
  router.post(
    '/:id/login',
    authenticate,
    authorize('user.create'),
    validate({ body: CreateEmployeeLoginSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createEmployeeLogin),
  );
  // E1 — adopt an EXISTING login as this employee's, and release it again. Gated on `user.edit`,
  // following the route above: both change which account belongs to an employee, so the gate is the
  // permission that governs the account. The service additionally resolves the employee under the
  // caller's `employee.view` scope, so neither side can be reached outside it.
  router.post(
    '/:id/user-link',
    authenticate,
    authorize('user.edit'),
    validate({ body: LinkEmployeeUserSchema, params: EmployeeIdParamSchema }),
    asyncHandler(linkEmployeeUser),
  );
  router.delete(
    '/:id/user-link',
    authenticate,
    authorize('user.edit'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(unlinkEmployeeUser),
  );

  return router;
};
