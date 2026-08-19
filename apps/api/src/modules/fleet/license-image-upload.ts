// The multipart intake shared by the two licence-image endpoints (vehicle and driver).
//
// It lives here rather than in either router because both accept exactly one image under exactly
// one field name and must refuse an oversized body the same way: a second copy would be a second
// place for the cap and the error code to drift apart.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../shared/errors';

/**
 * Outer multipart cap — a first-line defence that rejects an oversized body before it is buffered.
 * The file CATEGORY's `maxSizeMb` (10) remains authoritative and is what produces the user-facing
 * limit; this is deliberately looser so the category, not the router, owns the rule.
 */
export const LICENSE_IMAGE_MAX_MB = 15;

export const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LICENSE_IMAGE_MAX_MB * 1024 * 1024, files: 1 },
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
            `File exceeds the ${LICENSE_IMAGE_MAX_MB} MB cap`,
          ),
        );
        return;
      }
      next(error);
    });
  };
};
