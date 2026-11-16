// «رفع جماعي» over HTTP — thin mapping only (ADR-003): the workbook held in memory, the text fields
// handed on as they came, 200 with the preview, 201 with what an apply wrote.
//
// The upload is never spooled to disk (multer memory storage — the roster's and the ATM register
// import's precedent): it is read once, in this request, and dropped. Its own equivalent here
// rather than an import of theirs: modules do not reach into each other (the boundaries rule).
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes, IT_ASSET_IMPORT_MAX_MB } from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, ok } from '../../../platform/web';
import { AppError, ValidationError } from '../../../shared/errors';
import { itAssetImportService } from './asset-import.service';

/**
 * The text fields an upload may carry beside its file — `ItAssetImportFieldsSchema`'s six, the
 * largest `kindCategories` (≤ 20 000 characters, Arabic among them: two bytes each). busboy's
 * defaults are no count limit and 1 MB a field, all buffered before the controller runs, so the
 * cap bounds the fields too.
 */
const FIELDS_MAX = 6;
const FIELD_BYTES_MAX = 64 * 1024;

/** The multer limits whose breach is the cap's 422 `TOO_LARGE`, not a server error. */
const OVER_CAP: ReadonlySet<string> = new Set([
  'LIMIT_FILE_SIZE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_KEY',
  'LIMIT_PART_COUNT',
]);

/**
 * The workbook, in MEMORY: one file in the part `file`, at most `IT_ASSET_IMPORT_MAX_MB` — a file
 * is one branch's sheet, not the register — and at most `FIELDS_MAX` text fields of
 * `FIELD_BYTES_MAX` each. Past any of them, 422 `TOO_LARGE`; any other multipart refusal (a second
 * file, a file under another name) is a malformed request, 400.
 */
export const assetWorkbookUpload = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: IT_ASSET_IMPORT_MAX_MB * 1024 * 1024,
      files: 1,
      fields: FIELDS_MAX,
      fieldSize: FIELD_BYTES_MAX,
      parts: FIELDS_MAX + 1,
    },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        const file = error.code === 'LIMIT_FILE_SIZE';
        next(
          OVER_CAP.has(error.code)
            ? new AppError(
                ErrorCodes.VALIDATION_FAILED,
                422,
                file
                  ? `File exceeds the ${String(IT_ASSET_IMPORT_MAX_MB)} MB cap`
                  : 'The request exceeds the upload cap',
                {
                  details: [
                    {
                      field: file ? 'file' : 'body',
                      code: 'TOO_LARGE',
                      message: file ? `${String(IT_ASSET_IMPORT_MAX_MB)} MB` : error.code,
                    },
                  ],
                },
              )
            : new ValidationError(
                [
                  {
                    field: 'file',
                    code: error.code,
                    message: 'send one workbook, in a part named "file"',
                  },
                ],
                'send one workbook, in a part named "file"',
              ),
        );
        return;
      }
      next(error);
    });
  };
};

/** multer hands the original name over as latin1; an Arabic file name is UTF-8 underneath. */
const fileNameOf = (raw: string): string => {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
};

/**
 * Where the caller may register — the branch picker's options: the server's own reach of
 * `itAsset.create`, so the screen offers only branches the upload would accept.
 */
export const listItAssetImportBranches = async (req: Request, res: Response): Promise<void> => {
  ok(res, await itAssetImportService.branches(authContext(req)));
};

export const importItAssets = async (req: Request, res: Response): Promise<void> => {
  const file = (req as Request & { file?: { buffer: Buffer; originalname?: string } }).file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'no workbook was uploaded' },
    ]);
  }
  const outcome = await itAssetImportService.run(
    {
      buffer: file.buffer,
      fileName: fileNameOf(file.originalname ?? ''),
      fields: (req.body ?? {}) as unknown,
    },
    authContext(req),
  );
  if (outcome.kind === 'preview') ok(res, outcome.preview);
  else created(res, outcome.result);
};
