// Thin HTTP mapping only (ADR-003) for custody receipts (FR-18), plus the multipart intake of the
// signed copy — one file, one field name, an oversized body refused before it is buffered.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes, type HandOverItAssets, type PreviewItCustodyReceipt } from '@ecms/contracts';
import { created, ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { AppError, ValidationError } from '../../../shared/errors';
import { hasPermission, scopeSelector } from '../../../shared/types';
import { receiptNationalId, toItAssetDto, toItCustodyReceiptDto } from '../it.mappers';
import { itAssetCustodyService } from './custody.service';
import { itCustodyReceiptService } from './receipt.service';

type IdParam = { id: string };

/**
 * Outer multipart cap — a first line that refuses an oversized body before it is buffered. The
 * file CATEGORY's `maxSizeMb` (10) stays authoritative and is the limit the user is told.
 */
export const SIGNED_COPY_MAX_MB = 15;

export const signedCopyUpload = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: SIGNED_COPY_MAX_MB * 1024 * 1024, files: 1 },
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
            `File exceeds the ${SIGNED_COPY_MAX_MB} MB cap`,
          ),
        );
        return;
      }
      next(error);
    });
  };
};

/** Custody writes are gated on `itAsset.assign`; the SCOPE still comes from the read grant. */
const custodyScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.view');

/**
 * Whether this caller sees the holder's national ID in full (Security Architecture §3) — its own
 * grant, apart from printing: a receipt is read and reprinted on `itAsset.view`.
 */
const revealsNationalId = (req: Request): boolean =>
  hasPermission(authContext(req), 'itAsset.viewNationalId');

export const previewItCustodyReceipt = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PreviewItCustodyReceipt>(req);
  const paper = await itCustodyReceiptService.preview(body, custodyScope(req));
  ok(res, { ...paper, ...receiptNationalId(paper.nationalId, revealsNationalId(req)) });
};

export const handOverItAssets = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<HandOverItAssets>(req);
  const { receipt, assets } = await itAssetCustodyService.handOver(
    body,
    authContext(req),
    custodyScope(req),
  );
  created(res, {
    receipt: toItCustodyReceiptDto(receipt, revealsNationalId(req)),
    assets: assets.map(toItAssetDto),
  });
};

export const getItCustodyReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const receipt = await itCustodyReceiptService.get(params.id, custodyScope(req));
  ok(res, toItCustodyReceiptDto(receipt, revealsNationalId(req)));
};

/** «طباعة الإيصال» again — the receipt as it prints, its number assured. */
export const printItCustodyReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const receipt = await itCustodyReceiptService.print(
    params.id,
    authContext(req),
    custodyScope(req),
  );
  ok(res, toItCustodyReceiptDto(receipt, revealsNationalId(req)));
};

export const issueItAssignmentReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const receipt = await itCustodyReceiptService.issueForAssignment(
    params.id,
    authContext(req),
    custodyScope(req),
  );
  created(res, toItCustodyReceiptDto(receipt, revealsNationalId(req)));
};

export const uploadItCustodyReceiptSignedCopy = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const receipt = await itCustodyReceiptService.setSignedCopy(
    authContext(req),
    params.id,
    {
      originalName: uploaded.originalname,
      mime: uploaded.mimetype,
      size: uploaded.size,
      buffer: uploaded.buffer,
    },
    custodyScope(req),
  );
  ok(res, toItCustodyReceiptDto(receipt, revealsNationalId(req)));
};

export const getItCustodyReceiptSignedCopy = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const copy = await itCustodyReceiptService.readSignedCopy(
    authContext(req),
    params.id,
    custodyScope(req),
  );
  res.setHeader('Content-Type', copy.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(copy.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(copy.buffer);
};

export const deleteItCustodyReceiptSignedCopy = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const receipt = await itCustodyReceiptService.deleteSignedCopy(
    authContext(req),
    params.id,
    custodyScope(req),
  );
  ok(res, toItCustodyReceiptDto(receipt, revealsNationalId(req)));
};
