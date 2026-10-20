// Thin HTTP mapping only (ADR-003) for a line's acknowledgment — the device receipt's controller
// (`assets/receipt.controller.ts`) for the one-line paper, with the same multipart intake for its
// signed copy so the screen files either kind the same way.
import { type Request, type Response } from 'express';
import { type PreviewItMobileLineReceipt } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { hasPermission, scopeSelector } from '../../../shared/types';
import { receiptNationalId, toItMobileLineReceiptDto } from '../it.mappers';
import { itMobileLineReceiptService } from './line-receipt.service';

type IdParam = { id: string };

/** Custody writes are gated on `itAsset.assign`; the SCOPE still comes from the read grant. */
const custodyScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.view');

/** The holder's national ID in full only behind its own grant (Security Architecture §3). */
const revealsNationalId = (req: Request): boolean =>
  hasPermission(authContext(req), 'itAsset.viewNationalId');

export const previewItMobileLineReceipt = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PreviewItMobileLineReceipt>(req);
  const paper = await itMobileLineReceiptService.preview(body, custodyScope(req));
  ok(res, { ...paper, ...receiptNationalId(paper.nationalId, revealsNationalId(req)) });
};

export const getItMobileLineReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const receipt = await itMobileLineReceiptService.get(params.id, custodyScope(req));
  ok(res, toItMobileLineReceiptDto(receipt, revealsNationalId(req)));
};

/** Print again — the paper as it prints, its number assured. */
export const printItMobileLineReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const receipt = await itMobileLineReceiptService.print(
    params.id,
    authContext(req),
    custodyScope(req),
  );
  ok(res, toItMobileLineReceiptDto(receipt, revealsNationalId(req)));
};

export const uploadItMobileLineReceiptSignedCopy = async (
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
  const receipt = await itMobileLineReceiptService.setSignedCopy(
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
  ok(res, toItMobileLineReceiptDto(receipt, revealsNationalId(req)));
};

export const getItMobileLineReceiptSignedCopy = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const copy = await itMobileLineReceiptService.readSignedCopy(
    authContext(req),
    params.id,
    custodyScope(req),
  );
  res.setHeader('Content-Type', copy.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(copy.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(copy.buffer);
};

export const deleteItMobileLineReceiptSignedCopy = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const receipt = await itMobileLineReceiptService.deleteSignedCopy(
    authContext(req),
    params.id,
    custodyScope(req),
  );
  ok(res, toItMobileLineReceiptDto(receipt, revealsNationalId(req)));
};
