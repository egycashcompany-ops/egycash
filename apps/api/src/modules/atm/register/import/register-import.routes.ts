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
 * The text fields an upload may carry besides its file: the settlements import sends at most seven
 * (`LayoutImportFieldsSchema`, whose largest, `previewRevisions`, is ≤ 200 000 characters of
 * ASCII JSON), the register import three. busboy's defaults are no count limit and 1 MB a field,
 * all buffered before the controller runs, so the cap must bound the fields too (SEC-5).
 */
export const UPLOAD_FIELDS_MAX = 10;
export const UPLOAD_FIELD_BYTES_MAX = 256 * 1024;

/** The multer limits whose breach is the cap's 422 `TOO_LARGE`, not a server error. */
const OVER_CAP: ReadonlySet<string> = new Set([
  'LIMIT_FILE_SIZE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_KEY',
  'LIMIT_PART_COUNT',
]);

/**
 * The workbook upload, held in MEMORY: one file in field `file`, at most `maxMb` megabytes, and at
 * most `UPLOAD_FIELDS_MAX` text fields of `UPLOAD_FIELD_BYTES_MAX` each; the `TOO_LARGE` answer
 * beyond any of them. Shared with the settlements master import, which passes its own cap
 * (docs/12-planning/atm-settlements-phase1.md §6.3).
 */
export const workbookUpload = (maxMb: number): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxMb * 1024 * 1024,
      files: 1,
      fields: UPLOAD_FIELDS_MAX,
      fieldSize: UPLOAD_FIELD_BYTES_MAX,
      parts: UPLOAD_FIELDS_MAX + 1,
    },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && OVER_CAP.has(error.code)) {
        const file = error.code === 'LIMIT_FILE_SIZE';
        next(
          new AppError(
            ErrorCodes.VALIDATION_FAILED,
            422,
            file
              ? `File exceeds the ${String(maxMb)} MB cap`
              : 'The request exceeds the upload cap',
            {
              details: [
                {
                  field: file ? 'file' : 'body',
                  code: 'TOO_LARGE',
                  message: file ? `${String(maxMb)} MB` : error.code,
                },
              ],
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
