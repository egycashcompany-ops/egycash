// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type FleetDealershipSummaryQuery,
  type ListFleetDealershipInvoicesQuery,
  type UpdateFleetDealershipInvoice,
} from '@ecms/contracts';
import { noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import {
  fleetDealershipService,
  toDealershipInvoiceDto,
  type DealershipInvoiceWithJoins,
} from './dealership.service';

type IdParam = { id: string };

export const listDealershipInvoices = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetDealershipInvoicesQuery>(req);
  const { joins, ...page } = await fleetDealershipService.list(query);
  okPage(res, page, (doc) =>
    toDealershipInvoiceDto(joins.get(String(doc._id)) as DealershipInvoiceWithJoins),
  );
};

export const dealershipSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetDealershipSummaryQuery>(req);
  ok(res, await fleetDealershipService.summary(query));
};

export const getDealershipInvoice = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toDealershipInvoiceDto(await fleetDealershipService.get(params.id)));
};

export const updateDealershipInvoice = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetDealershipInvoice, never, IdParam>(req);
  ok(
    res,
    toDealershipInvoiceDto(
      await fleetDealershipService.update(params.id, body, authContext(req).userId),
    ),
  );
};

export const deleteDealershipInvoice = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetDealershipService.remove(params.id, authContext(req).userId);
  noContent(res);
};

export const uploadDealershipImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const row = await fleetDealershipService.setImage(authContext(req), params.id, {
    originalName: uploaded.originalname,
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  ok(res, toDealershipInvoiceDto(row));
};

export const getDealershipImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const image = await fleetDealershipService.readImage(authContext(req), params.id);
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(image.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(image.buffer);
};

export const deleteDealershipImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    toDealershipInvoiceDto(await fleetDealershipService.deleteImage(authContext(req), params.id)),
  );
};
