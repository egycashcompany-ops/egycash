// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the module
// never imports infrastructure directly (Module Structure §1). Literal paths (`/direct`,
// `/rehire-check`) are declared before `/:id`. The status endpoint moved to the
// employee-actions feature (deprecated alias over the engine).
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { AppError, ValidationError } from '../../../../shared/errors';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  checkEmployeeCode,
  createEmployee,
  createEmployeeLogin,
  getJobTitlePlacements,
  getLastEmployeeCode,
  getEmployee,
  getMyEmployeeProfile,
  getMyEmployeePhoto,
  getMyEmployeeSummary,
  getEmployeePhoto,
  getEmployeeTimeline,
  getEmployeeIdCard,
  recordEmployeeIdCardPrint,
  confirmEmployeeIdCardHandover,
  recordEmployeeIdCardReceipt,
  listEmployeeIdCardPrints,
  linkEmployeeUser,
  listEmployees,
  listSubordinates,
  getEmployeeNationalIdCard,
  registerEmployeeDirect,
  registerEmployeeExternal,
  rehireCheck,
  removeEmployeePhoto,
  unlinkEmployeeUser,
  changeEmployeeCode,
  updateEmployeeInsurance,
  updateEmployeeOfficer,
  updateEmployeePersonal,
  uploadEmployeePhoto,
} from './employee.controller';
import {
  CreateEmployeeLoginSchema,
  CreateEmployeeSchema,
  DirectRegisterEmployeeSchema,
  RegisterExternalEmployeeSchema,
  EmployeeCodeCheckQuerySchema,
  EmployeeIdParamSchema,
  JobTitlePlacementQuerySchema,
  LinkEmployeeUserSchema,
  ListEmployeesQuerySchema,
  RehireCheckQuerySchema,
  ChangeEmployeeCodeSchema,
  UpdateEmployeeInsuranceSchema,
  UpdateEmployeeOfficerSchema,
  UpdateEmployeePersonalSchema,
} from './employee.validation';
import { importEmployeeRoster, ROSTER_MAX_MB } from './employee-roster-import';
import { EMPLOYEE_PHOTO_MAX_BYTES, EMPLOYEE_PHOTO_SIZE_RULE } from './employee-photo.files';

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
        next(
          new AppError(
            ErrorCodes.VALIDATION_FAILED,
            422,
            `File exceeds the ${ROSTER_MAX_MB} MB cap`,
          ),
        );
        return;
      }
      next(error);
    });
  };
};

const PHOTO_PART_RULE = 'send exactly one photo, in a part named "file"';

/**
 * One photo, under the field name `file`, held in memory: it goes straight on to the Files service.
 *
 * The cap is the photo's own limit, so an oversized body is refused before it is buffered, and with
 * the same validation error — and the same words — the service uses for an oversized photo. Every
 * other multipart refusal (a second file, a part under another name) is a malformed request too,
 * and says so as a 400 rather than reaching the error handler as an unexpected failure.
 */
const photoUpload = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: EMPLOYEE_PHOTO_MAX_BYTES, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        next(
          error.code === 'LIMIT_FILE_SIZE'
            ? new ValidationError(
                [{ field: 'file', code: 'TOO_LARGE', message: EMPLOYEE_PHOTO_SIZE_RULE }],
                EMPLOYEE_PHOTO_SIZE_RULE,
              )
            : new ValidationError(
                [{ field: 'file', code: error.code, message: PHOTO_PART_RULE }],
                PHOTO_PART_RULE,
              ),
        );
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
  // An EXTERNAL person (تعيين خارجى) — not a hire, and the smallest body in this router: a name,
  // where they sit, and what they do. Same permission as a direct registration, because it is the
  // same act (putting somebody in the registry) with less of it.
  router.post(
    '/external',
    authenticate,
    authorize('employee.registerDirect'),
    validate({ body: RegisterExternalEmployeeSchema }),
    asyncHandler(registerEmployeeExternal),
  );
  // The register screen's three helpers (declared before /:id), behind the permission to register:
  // the last code issued, what a typed code means, and where a job title's people sit in a branch.
  router.get(
    '/last-code',
    authenticate,
    authorize('employee.registerDirect'),
    asyncHandler(getLastEmployeeCode),
  );
  router.get(
    '/code-check',
    authenticate,
    authorize('employee.registerDirect'),
    validate({ query: EmployeeCodeCheckQuerySchema }),
    asyncHandler(checkEmployeeCode),
  );
  router.get(
    '/job-title-placements',
    authenticate,
    authorize('employee.registerDirect'),
    validate({ query: JobTitlePlacementQuerySchema }),
    asyncHandler(getJobTitlePlacements),
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
  /**
   * The welcome page's two reads of the caller's OWN record — the card (name, placement, birthday)
   * and the photo. Same rules as `/me`: declared before `/:id`, `authenticate` only, the employee
   * from the token, and a 404 for a login with no employee behind it. The photo's ADR-023 rule
   * independently lets an employee read their own and nobody else's.
   */
  router.get('/me/summary', authenticate, asyncHandler(getMyEmployeeSummary));
  router.get('/me/photo', authenticate, asyncHandler(getMyEmployeePhoto));
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
  // The Employee Code, changed by hand (ADR-017, amended 2026-11-01). Its own permission: a code is
  // on badges and contracts, and how the roster file names a person.
  router.patch(
    '/:id/code',
    authenticate,
    authorize('employee.changeCode'),
    validate({ body: ChangeEmployeeCodeSchema, params: EmployeeIdParamSchema }),
    asyncHandler(changeEmployeeCode),
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
  // The personal photo. Seeing it is seeing the employee (`employee.view`, scoped like `GET /:id`);
  // setting or removing it is a personal-data edit (`employee.editPersonal`, scoped like
  // `PATCH /:id/personal`). The GET answers with the image bytes, not the JSON envelope.
  router.get(
    '/:id/photo',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeePhoto),
  );
  router.post(
    '/:id/photo',
    authenticate,
    authorize('employee.editPersonal'),
    photoUpload(),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(uploadEmployeePhoto),
  );
  router.delete(
    '/:id/photo',
    authenticate,
    authorize('employee.editPersonal'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(removeEmployeePhoto),
  );
  // The company ID card (كارنيه الشركة). Printing it, and reading what goes on it — the national ID
  // in full — is a personal-data edit's authority; seeing how often it was printed is seeing the
  // employee. See `employee-id-card.ts`.
  router.get(
    '/:id/id-card',
    authenticate,
    authorize('employee.editPersonal'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeeIdCard),
  );
  router.post(
    '/:id/id-card/prints',
    authenticate,
    authorize('employee.editPersonal'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(recordEmployeeIdCardPrint),
  );
  router.post(
    '/:id/id-card/receipts',
    authenticate,
    authorize('employee.editPersonal'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(recordEmployeeIdCardReceipt),
  );
  router.post(
    '/:id/id-card/handovers',
    authenticate,
    authorize('employee.editPersonal'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(confirmEmployeeIdCardHandover),
  );
  router.get(
    '/:id/id-card/prints',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(listEmployeeIdCardPrints),
  );
  // The National-ID card (front and back) carried over from the applicant file at hire.
  router.get(
    '/:id/national-id-card',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeeNationalIdCard),
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
