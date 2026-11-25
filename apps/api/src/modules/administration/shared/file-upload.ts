// The module's multipart intake (design §11.1–§11.2): one file, under the field `file`, for every
// paper endpoint — a supplier's papers now, a request's, a receipt's and a count's later — so the
// cap and its refusal live in one place instead of drifting apart per route (Fleet's reason for
// its one licence-image intake).
//
// The CAP is a first-line defence that refuses an oversized body before it is buffered; the file
// CATEGORY's limit stays the one a user meets, so the cap sits 5 MB above it — and never above the
// deployment's own `MAX_UPLOAD_MB`, so a deployment that lowers the platform's cap lowers this one
// too (§11.2). The NAME is the one the person gave the file: multer reads a multipart file name as
// latin1, so an Arabic «السجل التجاري.pdf» arrives as its UTF-8 bytes one latin1 character each
// and is turned back here — the rule Fleet's and ATM's uploads apply, written for this module
// because it imports no other (§3.7).
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { env } from '../../../infrastructure/config/env';
import { AppError } from '../../../shared/errors';

/** The margin the multipart cap keeps above a category's limit (§11.2: 15 MB over 10, 25 over 20). */
const CAP_MARGIN_MB = 5;

/** The multipart cap for a category whose limit is `categoryMaxMb`, in MB. */
export const uploadCapMb = (categoryMaxMb: number, deploymentMaxMb: number): number =>
  Math.min(categoryMaxMb + CAP_MARGIN_MB, deploymentMaxMb);

/** One file under `file`, held in memory up to the cap for a category of `categoryMaxMb`. */
export const multipartUpload = (categoryMaxMb: number): RequestHandler => {
  const capMb = uploadCapMb(categoryMaxMb, env.MAX_UPLOAD_MB);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: capMb * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${capMb} MB cap`));
        return;
      }
      next(error);
    });
  };
};

/** The original file name, decoded from latin1 to UTF-8 when that is what it is; '' when none. */
export const uploadedFileName = (raw: string | undefined): string => {
  if (raw === undefined || raw === '') return '';
  // A character past latin1 means the name already arrived decoded — nothing to undo.
  for (const char of raw) {
    if ((char.codePointAt(0) ?? 0) > 0xff) return raw;
  }
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  // A name that does not decode cleanly is kept as it came: this never makes a name worse.
  return decoded.includes('�') ? raw : decoded;
};
