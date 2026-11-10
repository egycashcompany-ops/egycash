// The multipart intake for the shipment receipt photo.
//
// A local copy of Fleet's `license-image-upload.ts` on purpose: `operations/fleet-boundary.ts` is
// the ONE place Operations touches Fleet, and a request-parsing helper is not worth a second seam.
// The platform has no shared multer helper — each module that takes an upload owns its own.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../shared/errors';

/**
 * Outer multipart cap — a first-line defence that rejects an oversized body before it is buffered.
 * The file CATEGORY's `maxSizeMb` (10) remains authoritative and is what produces the user-facing
 * limit; this is deliberately looser so the category, not the router, owns the rule.
 */
export const RECEIPT_IMAGE_MAX_MB = 15;

export const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: RECEIPT_IMAGE_MAX_MB * 1024 * 1024, files: 1 },
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
            `File exceeds the ${RECEIPT_IMAGE_MAX_MB} MB cap`,
          ),
        );
        return;
      }
      next(error);
    });
  };
};
