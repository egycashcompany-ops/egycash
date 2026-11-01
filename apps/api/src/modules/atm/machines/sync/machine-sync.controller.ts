// Thin HTTP mapping only (ADR-003). The multipart fields arrive as strings: `apply` is "true" or
// nothing — any other value compares, never writes (the import's rule: the default is harmless).
import { type Request, type Response } from 'express';
import { authContext } from '../../../../platform/auth';
import { ok } from '../../../../platform/web';
import { ValidationError } from '../../../../shared/errors';
import { atmMachineSyncService } from './machine-sync.service';

/** multer hands the original name over as latin1; an Arabic file name is UTF-8 underneath. */
const fileNameOf = (raw: string): string => {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
};

export const syncMachines = async (req: Request, res: Response): Promise<void> => {
  const file = (req as Request & { file?: { buffer: Buffer; originalname?: string } }).file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'no workbook was uploaded' },
    ]);
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const apply = body.apply === 'true';
  const fileSha256 =
    typeof body.fileSha256 === 'string' && body.fileSha256 !== '' ? body.fileSha256 : null;
  if (apply && fileSha256 === null) {
    throw new ValidationError([
      {
        field: 'fileSha256',
        code: 'REQUIRED',
        message: 'the comparison hash is required to apply',
      },
    ]);
  }
  ok(
    res,
    await atmMachineSyncService.run(
      { buffer: file.buffer, fileName: fileNameOf(file.originalname ?? ''), apply, fileSha256 },
      authContext(req),
    ),
  );
};
