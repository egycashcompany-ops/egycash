// The register workbook import (spec §5.7, §6), mounted at /atm/register/import and listed BEFORE
// /atm/register in the manifest.
//
//   POST /      authorize('atmRegister.import') + the workbook held in MEMORY (20 MB, one file).
//               Preview unless `apply` names categories; an apply additionally needs
//               atmRegister.viewSecrets (DEC-7, checked by the service) and per-branch reach
//               (the plan's `branchOutOfReach` / `secretsOutOfReach` blockers).
//   GET  /runs  authorize('atmRegister.import') — the last 50 runs, without their per-row outcomes.
//
// The upload is never spooled to disk (multer memory storage, the roster precedent): it is read
// once, in this request, and dropped. Responses carry register names and codes, so they are not
// cached anywhere either.
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler } from '../../../../platform/web';
import { AppError } from '../../../../shared/errors';
import { importRegisterWorkbook, listRegisterImportRuns } from './register-import.controller';

/** The owner's workbook is 4.7 MB; the cap is against a mistake, not a size. */
export const REGISTER_IMPORT_MAX_MB = 20;

/**
 * The workbook upload, held in MEMORY: one file in field `file`, at most `maxMb` megabytes, the
 * `TOO_LARGE` answer beyond it. Shared with the settlements master import, which passes its own
 * cap (docs/12-planning/atm-settlements-phase1.md §6.3).
 */
export const workbookUpload = (maxMb: number): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
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
            `File exceeds the ${String(maxMb)} MB cap`,
            {
              details: [{ field: 'file', code: 'TOO_LARGE', message: `${String(maxMb)} MB` }],
            },
          ),
        );
        return;
      }
      next(error);
    });
  };
};

/** `Cache-Control: private, no-store` — the responses carry names and codes. */
export const noStore = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};

export const buildAtmRegisterImportRouter = (): Router => {
  const router = Router();
  router.use(noStore);
  router.post(
    '/',
    authenticate,
    authorize('atmRegister.import'),
    workbookUpload(REGISTER_IMPORT_MAX_MB),
    asyncHandler(importRegisterWorkbook),
  );
  router.get(
    '/runs',
    authenticate,
    authorize('atmRegister.import'),
    asyncHandler(listRegisterImportRuns),
  );
  return router;
};
