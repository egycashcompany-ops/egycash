// Thin HTTP mapping only (ADR-003) — «استيراد فروع من شيت» (Round 29). The actor is the token's.
import { type Request, type Response } from 'express';
import {
  type ApplyOperationsBranchImport,
  type CompareOperationsBranchImport,
} from '@ecms/contracts';
import { authContext } from '../../../../platform/auth';
import { ok, validated } from '../../../../platform/web';
import { ValidationError } from '../../../../shared/errors';
import { receiptImageFileName as uploadFileName } from '../../shipments/receipt-image-upload';
import { operationsBranchImportService } from './branch-import.service';

const sheetOf = (req: Request): { buffer: Buffer; fileName: string } => {
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  // An Arabic file name arrives as latin1-spelled UTF-8 — the name as the person gave it.
  return { buffer: uploaded.buffer, fileName: uploadFileName(uploaded.originalname) };
};

export const compareBranchImport = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CompareOperationsBranchImport>(req);
  ok(res, await operationsBranchImportService.compare({ bankId: body.bankId, ...sheetOf(req) }));
};

export const applyBranchImport = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ApplyOperationsBranchImport>(req);
  ok(
    res,
    await operationsBranchImportService.apply(
      {
        bankId: body.bankId,
        fileSha256: body.fileSha256,
        planDigest: body.planDigest,
        ...sheetOf(req),
      },
      authContext(req).userId,
    ),
  );
};
