// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetReceipt,
  type FleetReceiptSummaryQuery,
  type ListFleetReceiptsQuery,
  type UpdateFleetReceipt,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { fleetReceiptService, toReceiptDto, type ReceiptWithJoins } from './receipt.service';

type IdParam = { id: string };

export const listReceipts = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetReceiptsQuery>(req);
  const { joins, ...page } = await fleetReceiptService.list(query);
  okPage(res, page, (doc) => toReceiptDto(joins.get(String(doc._id)) as ReceiptWithJoins));
};

export const receiptSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetReceiptSummaryQuery>(req);
  ok(res, await fleetReceiptService.summary(query));
};

export const getReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toReceiptDto(await fleetReceiptService.get(params.id)));
};

export const createReceipt = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetReceipt>(req);
  created(res, toReceiptDto(await fleetReceiptService.create(body, authContext(req).userId)));
};

export const updateReceipt = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetReceipt, never, IdParam>(req);
  ok(res, toReceiptDto(await fleetReceiptService.update(params.id, body, authContext(req).userId)));
};

export const deleteReceipt = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetReceiptService.remove(params.id, authContext(req).userId);
  noContent(res);
};

export const uploadReceiptImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const row = await fleetReceiptService.setImage(authContext(req), params.id, {
    originalName: uploaded.originalname,
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  ok(res, toReceiptDto(row));
};

export const getReceiptImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const image = await fleetReceiptService.readImage(authContext(req), params.id);
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(image.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(image.buffer);
};

export const deleteReceiptImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toReceiptDto(await fleetReceiptService.deleteImage(authContext(req), params.id)));
};
