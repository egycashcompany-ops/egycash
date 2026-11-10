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

/**
 * The uploaded file's name as the person named it, decoded from latin1 to UTF-8 when that is what
 * it is; '' when none.
 *
 * Multer reads a multipart `filename` as latin1 by default, so an Arabic «إيصال ١.jpg» arrives as
 * its UTF-8 bytes spelled one latin1 character each. A local copy of Fleet's `upload-file-name.ts`
 * (`uploadFileName`) for the same reason as `multipartSingle` above — keep the two in step. It never
 * makes a name worse: a name that does not decode cleanly is kept as it came.
 */
export const receiptImageFileName = (raw: string | undefined): string => {
  if (raw === undefined || raw === '') return '';
  // A character past latin1 means the name already arrived decoded — nothing to undo.
  for (const char of raw) {
    if ((char.codePointAt(0) ?? 0) > 0xff) return raw;
  }
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? raw : decoded;
};
