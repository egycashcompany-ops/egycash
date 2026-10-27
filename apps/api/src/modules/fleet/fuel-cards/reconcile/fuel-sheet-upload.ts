// The sheet's multipart intake — one `.xlsx` under `file`, beside the `company` text field.
//
// Held in MEMORY (multer memory storage): the upload is read once, in this request, and dropped —
// never spooled to disk, and the reader reduces it in memory too (`read-fuel-sheet.ts`). An
// oversized file is refused before it is buffered, the way the licence images are.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes, FLEET_FUEL_SHEET_MAX_MB } from '@ecms/contracts';
import { AppError, ValidationError } from '../../../../shared/errors';

export const fuelSheetUpload = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: FLEET_FUEL_SHEET_MAX_MB * 1024 * 1024, files: 1, fields: 4 },
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
            `File exceeds the ${String(FLEET_FUEL_SHEET_MAX_MB)} MB cap`,
            {
              details: [
                {
                  field: 'file',
                  code: 'TOO_LARGE',
                  message: `${String(FLEET_FUEL_SHEET_MAX_MB)} MB`,
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

/** Readings carry card names and balances — kept out of every cache. */
export const noStore = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};
