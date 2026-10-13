// Thin HTTP mapping only (ADR-003), spec §6.7.
//
// The multipart fields arrive as strings. `apply` is a comma list of category names, and ANY name
// that is not a category is DROPPED — never read as "all" (the roster import's rule): the default
// has to be the harmless one, so a malformed request previews instead of writing.
import { type Request, type Response } from 'express';
import { ATM_REGISTER_IMPORT_CATEGORIES, type AtmRegisterImportCategory } from '@ecms/contracts';
import { authContext } from '../../../../platform/auth';
import { ok } from '../../../../platform/web';
import { ValidationError } from '../../../../shared/errors';
import { atmRegisterImportService } from './register-import.service';

const requestedCategories = (raw: unknown): AtmRegisterImportCategory[] => {
  const names = (typeof raw === 'string' ? raw : '').split(',').map((s) => s.trim());
  return ATM_REGISTER_IMPORT_CATEGORIES.filter((category) => names.includes(category));
};

/** multer hands the original name over as latin1; an Arabic file name is UTF-8 underneath. */
const fileNameOf = (raw: string): string => {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
};

export const importRegisterWorkbook = async (req: Request, res: Response): Promise<void> => {
  const file = (req as Request & { file?: { buffer: Buffer; originalname?: string } }).file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'no workbook was uploaded' },
    ]);
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const apply = requestedCategories(body.apply);
  const fileSha256 =
    typeof body.fileSha256 === 'string' && body.fileSha256 !== '' ? body.fileSha256 : null;
  if (apply.length > 0 && fileSha256 === null) {
    throw new ValidationError([
      { field: 'fileSha256', code: 'REQUIRED', message: 'the preview hash is required to apply' },
    ]);
  }
  ok(
    res,
    await atmRegisterImportService.run(
      {
        buffer: file.buffer,
        fileName: fileNameOf(file.originalname ?? ''),
        apply,
        fileSha256,
        reportOverride: body.reportOverride === 'true',
      },
      authContext(req),
    ),
  );
};

export const listRegisterImportRuns = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await atmRegisterImportService.listRuns());
};
