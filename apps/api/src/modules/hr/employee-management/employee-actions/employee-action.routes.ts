// Router: authenticate → authorize → validate → controller. One Personnel Actions engine,
// permission-grouped routes (frozen design F5): employment / compensation / exit / rehire.
// Cancel requires the permission of the targeted ACTION's group — the route admits any group
// holder and the service resolves the exact group; listing follows employee.view.
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { asyncHandler, validate } from '../../../../platform/web';
import { AppError } from '../../../../shared/errors';
import { authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
import {
  attachActionDocument,
  cancelEmployeeAction,
  changeEmployeeStatusAlias,
  createCompensationAction,
  createEmploymentAction,
  createExitAction,
  createRehireAction,
  listActionOverlaps,
  listEmployeeActions,
} from './employee-action.controller';
import { ChangeEmployeeStatusSchema, ErrorCodes } from '@ecms/contracts';
import {
  ActionOverlapsQuerySchema,
  CancelEmployeeActionSchema,
  CompensationActionSchema,
  EmployeeActionIdParamSchema,
  EmploymentActionSchema,
  ExitActionSchema,
  ListEmployeeActionsQuerySchema,
  RehireActionSchema,
} from './employee-action.validation';
import { EmployeeIdParamSchema } from '../employees/employee.validation';

/** Outer multipart cap (first-line defence); the file category's `maxSizeMb` is authoritative. */
const ATTACHMENT_MAX_MB = 15;

const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${ATTACHMENT_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

/** Mounted under `/hr/employees` — paths are relative to `/:id/actions`. */
export const buildEmployeeActionsRouter = (): Router => {
  const router = Router({ mergeParams: true });

  router.get(
    '/:id/actions',
    authenticate,
    authorize('employee.view'),
    validate({ query: ListEmployeeActionsQuerySchema, params: EmployeeIdParamSchema }),
    asyncHandler(listEmployeeActions),
  );
  // The overlap warning (C1) — a READ about an action that does not exist yet, so it carries the
  // intended type in the query. Same key as the history it is drawn from.
  router.get(
    '/:id/actions/overlaps',
    authenticate,
    authorize('employee.view'),
    validate({ query: ActionOverlapsQuerySchema, params: EmployeeIdParamSchema }),
    asyncHandler(listActionOverlaps),
  );
  // HR3-C — the document an action will be created WITH. It comes FIRST because an action is
  // immutable once written, so the file has to exist before the action that names it. Admitted
  // for any of the four groups; which one applies is decided when the action itself is created.
  router.post(
    '/:id/actions/attachment',
    authenticate,
    authorizeAny(
      'employee.manageActions',
      'employee.manageCompensation',
      'employee.exit',
      'employee.rehire',
    ),
    multipartSingle(),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(attachActionDocument),
  );
  router.post(
    '/:id/actions/employment',
    authenticate,
    authorize('employee.manageActions'),
    validate({ body: EmploymentActionSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createEmploymentAction),
  );
  router.post(
    '/:id/actions/compensation',
    authenticate,
    authorize('employee.manageCompensation'),
    validate({ body: CompensationActionSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createCompensationAction),
  );
  router.post(
    '/:id/actions/exit',
    authenticate,
    authorize('employee.exit'),
    validate({ body: ExitActionSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createExitAction),
  );
  router.post(
    '/:id/actions/rehire',
    authenticate,
    authorize('employee.rehire'),
    validate({ body: RehireActionSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createRehireAction),
  );
  // DEPRECATED alias (one release): the old status endpoint, translated onto the engine.
  router.patch(
    '/:id/status',
    authenticate,
    authorize('employee.changeStatus'),
    validate({ body: ChangeEmployeeStatusSchema, params: EmployeeIdParamSchema }),
    asyncHandler(changeEmployeeStatusAlias),
  );
  router.post(
    '/:id/actions/:actionId/cancel',
    authenticate,
    authorizeAny(
      'employee.manageActions',
      'employee.manageCompensation',
      'employee.exit',
      'employee.rehire',
    ),
    validate({ body: CancelEmployeeActionSchema, params: EmployeeActionIdParamSchema }),
    asyncHandler(cancelEmployeeAction),
  );

  return router;
};
