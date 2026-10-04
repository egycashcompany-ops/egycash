// Thin HTTP mapping only (ADR-003) for custody receipts (FR-18), plus the multipart intake of the
// signed copy — one file, one field name, an oversized body refused before it is buffered.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes, type HandOverItAssets, type PreviewItCustodyReceipt } from '@ecms/contracts';
import { created, ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { AppError, ValidationError } from '../../../shared/errors';
import { scopeSelector } from '../../../shared/types';
import { toItAssetDto, toItCustodyReceiptDto } from '../it.mappers';
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

export const previewItCustodyReceipt = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PreviewItCustodyReceipt>(req);
  ok(res, await itCustodyReceiptService.preview(body, custodyScope(req)));
};

export const handOverItAssets = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<HandOverItAssets>(req);
  const { receipt, assets } = await itAssetCustodyService.handOver(
    body,
    authContext(req),
    custodyScope(req),
  );
  created(res, { receipt: toItCustodyReceiptDto(receipt), assets: assets.map(toItAssetDto) });
};

export const getItCustodyReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItCustodyReceiptDto(await itCustodyReceiptService.get(params.id, custodyScope(req))));
};

export const issueItAssignmentReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const receipt = await itCustodyReceiptService.issueForAssignment(
    params.id,
    authContext(req),
    custodyScope(req),
  );
  created(res, toItCustodyReceiptDto(receipt));
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
  ok(res, toItCustodyReceiptDto(receipt));
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
  ok(res, toItCustodyReceiptDto(receipt));
};
