// The branch sheet's multipart intake (Round 29) — one `.xlsx` under `file`, beside the import's
// text fields. Held in MEMORY: the sheet is read once, in this request, and dropped — never spooled
// to disk. An oversized file is refused before it is buffered. The fuel-card sheet's intake
// (`fleet/fuel-cards/reconcile/fuel-sheet-upload.ts`), Operations' own copy: a module owns its
// uploads (the shipment receipt photo's precedent, `shipments/receipt-image-upload.ts`).
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes, OPERATIONS_BRANCH_IMPORT_MAX_MB } from '@ecms/contracts';
import { AppError, ValidationError } from '../../../../shared/errors';

export const branchSheetUpload = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: OPERATIONS_BRANCH_IMPORT_MAX_MB * 1024 * 1024, files: 1, fields: 4 },
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
            ErrorCodes.FILE_TOO_LARGE,
            422,
            `File exceeds the ${String(OPERATIONS_BRANCH_IMPORT_MAX_MB)} MB cap`,
            {
              details: [
                {
                  field: 'file',
                  code: 'TOO_LARGE',
                  message: `${String(OPERATIONS_BRANCH_IMPORT_MAX_MB)} MB`,
                },
              ],
            },
          ),
        );
        return;
      }
      // A second file, another field name, too many fields: the request's fault, said as such.
      if (error instanceof multer.MulterError) {
        next(
          new ValidationError([
            { field: 'file', code: error.code, message: 'one sheet under "file"' },
          ]),
        );
        return;
      }
      next(error);
    });
  };
};

/** A branch list is nobody's to cache. */
export const noStore = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};
