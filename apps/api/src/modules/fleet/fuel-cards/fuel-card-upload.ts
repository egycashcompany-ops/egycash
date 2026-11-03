// The card photo's multipart intake (6d): the photo under `file` and, beside it, its thumbnail
// under `thumb` — the browser makes the thumbnail (the server never decodes an image) and the
// server checks it from its header (`fuel-card-thumbs.ts`). The same outer cap and refusal as the
// licence images' `multipartSingle` (`../license-image-upload.ts`, left as it is).
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { AppError, ValidationError } from '../../../shared/errors';
import { LICENSE_IMAGE_MAX_MB } from '../license-image-upload';

const intake = (fields: { name: string; maxCount: number }[]): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LICENSE_IMAGE_MAX_MB * 1024 * 1024, files: fields.length },
  }).fields(fields);
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
            `File exceeds the ${String(LICENSE_IMAGE_MAX_MB)} MB cap`,
          ),
        );
        return;
      }
      if (error instanceof multer.MulterError) {
        next(
          new ValidationError([
            {
              field: error.field ?? 'file',
              code: error.code,
              message: `one file under each of: ${fields.map((field) => field.name).join(', ')}`,
            },
          ]),
        );
        return;
      }
      next(error);
    });
  };
};

/** `file` (the photo) and, optional, `thumb` (its thumbnail). */
export const multipartImageAndThumb = (): RequestHandler =>
  intake([
    { name: 'file', maxCount: 1 },
    { name: 'thumb', maxCount: 1 },
  ]);

/** `thumb` alone — a thumbnail for the photo the card already has. */
export const multipartThumb = (): RequestHandler => intake([{ name: 'thumb', maxCount: 1 }]);

/** The uploaded part named `name`, when one came. */
export const partOf = (req: Request, name: string): Express.Multer.File | undefined => {
  const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
  return files?.[name]?.[0];
};
