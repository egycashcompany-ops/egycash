// The module's multipart intake (design §5): one file, under the field `file`, for a document and
// for a folder's cover alike, so the cap and its refusal live in one place.
//
// Three things happen to a file before the platform's Files service sees it:
//
//   * the CAP — a first-line defence that refuses an oversized body before it is buffered. It sits
//     5 MB above the category's own limit, which stays the one a person meets («20M»), and never
//     above the deployment's `MAX_UPLOAD_MB`;
//   * the NAME — multer reads a multipart file name as latin1, so «عقد التوريد.pdf» arrives as its
//     UTF-8 bytes one latin1 character each and is turned back here;
//   * the TYPE — a browser sends Word and Excel files under several types (and an empty one, or
//     `application/octet-stream`, on some systems). The extension decides what the file is meant
//     to be, and its first bytes must agree: a PDF starts `%PDF-`, a .docx and a .xlsx are zip
//     archives, a .doc and a .xls are the older compound files. A picture renamed «.pdf» is refused
//     here rather than stored as a PDF nobody can open.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import {
  type COMPLIANCE_COVER_MIMES,
  COMPLIANCE_DOCUMENT_TYPES,
  ErrorCodes,
  complianceExtensionOf,
  type ComplianceDocumentKind,
} from '@ecms/contracts';
import { env } from '../../../infrastructure/config/env';
import { AppError, ValidationError } from '../../../shared/errors';
import { type UploadedBinary } from '../../../platform/files';

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
  for (const char of raw) {
    if ((char.codePointAt(0) ?? 0) > 0xff) return raw;
  }
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
};

const startsWith = (buffer: Buffer, bytes: readonly number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK.. — .docx, .xlsx
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // compound file — .doc, .xls, and a protected .docx/.xlsx

/**
 * Does the content match the kind its name claims? A PDF may carry a few bytes before its header
 * (some scanners write them), so its marker is looked for in the first kilobyte.
 */
export const contentMatches = (extension: string, buffer: Buffer): boolean => {
  switch (extension) {
    case '.pdf':
      return startsWith(buffer, PDF) || buffer.subarray(0, 1024).includes(Buffer.from(PDF));
    case '.docx':
    case '.xlsx':
      // A password-protected .docx or .xlsx is stored as a compound file around its encrypted
      // package, not as a zip; it is kept (and offered as a download — it cannot be previewed).
      return startsWith(buffer, ZIP) || startsWith(buffer, OLE);
    case '.doc':
    case '.xls':
      return startsWith(buffer, OLE);
    default:
      return false;
  }
};

const refuse = (code: string, message: string): ValidationError =>
  new ValidationError([{ field: 'file', code, message }]);

/** The multer file, or a 400 naming the missing part. */
export const requireFile = (file: Express.Multer.File | undefined): Express.Multer.File => {
  if (file === undefined) throw refuse('REQUIRED', 'a file part named "file" is required');
  return file;
};

/**
 * A document as the Files service will store it: its type decided by its extension, its content
 * checked against that. 422 `FILE_TYPE_NOT_ALLOWED` for a name that is not PDF, Word or Excel; 422
 * `COMPLIANCE_FILE_CONTENT_MISMATCH` for content that is not what the name says.
 */
export const documentBinary = (
  file: Express.Multer.File,
): { binary: UploadedBinary; kind: ComplianceDocumentKind } => {
  const originalName = uploadedFileName(file.originalname);
  const extension = complianceExtensionOf(originalName);
  const type = COMPLIANCE_DOCUMENT_TYPES[extension];
  if (type === undefined) {
    throw new AppError(
      ErrorCodes.FILE_TYPE_NOT_ALLOWED,
      422,
      'only PDF, Word (.doc, .docx) and Excel (.xls, .xlsx) files are kept here',
      { details: [{ field: 'file', code: 'type', message: extension || '(none)' }] },
    );
  }
  if (!contentMatches(extension, file.buffer)) {
    throw new AppError(
      ErrorCodes.COMPLIANCE_FILE_CONTENT_MISMATCH,
      422,
      `the file's contents are not a ${extension} file`,
      { details: [{ field: 'file', code: 'contentMismatch', message: extension }] },
    );
  }
  return {
    binary: { originalName, mime: type.mime, size: file.size, buffer: file.buffer },
    kind: type.kind,
  };
};

const IMAGE_SIGNATURES: readonly {
  mime: (typeof COMPLIANCE_COVER_MIMES)[number];
  test: (b: Buffer) => boolean;
}[] = [
  { mime: 'image/jpeg', test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    mime: 'image/png',
    test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mime: 'image/webp',
    test: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      b.length >= 12 &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/**
 * A cover picture: JPEG, PNG or WebP, decided by its bytes rather than by the type the browser
 * sent. 422 `FILE_TYPE_NOT_ALLOWED` for anything else.
 */
export const coverBinary = (file: Express.Multer.File): UploadedBinary => {
  const found = IMAGE_SIGNATURES.find((signature) => signature.test(file.buffer));
  if (found === undefined) {
    throw new AppError(
      ErrorCodes.FILE_TYPE_NOT_ALLOWED,
      422,
      'a cover is a JPEG, PNG or WebP picture',
      { details: [{ field: 'file', code: 'type', message: file.mimetype }] },
    );
  }
  return {
    originalName: uploadedFileName(file.originalname) || 'cover',
    mime: found.mime,
    size: file.size,
    buffer: file.buffer,
  };
};
