// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CompleteOperationsShipment,
  type CreateOperationsShipment,
  type ListOperationsShipmentsQuery,
  type OperationsDayBoardDto,
  type OperationsDayBoardQuery,
  type OperationsShipmentHistoryDto,
  type OperationsShipmentHistoryQuery,
  type UpdateOperationsShipment,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { hasPermission } from '../../../shared/types';
import { toShipmentDto } from '../operations.mappers';
import { receiptImageFileName } from './receipt-image-upload';
import { operationsShipmentService, type DayBoardView } from './shipment.service';

type IdParam = { id: string };

export const listShipments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsShipmentsQuery>(req);
  okPage(res, await operationsShipmentService.list(query), toShipmentDto);
};

/**
 * Who rides which van, and how to reach its captain, is the crew plan — `operationsCrew.view`'s,
 * the crew board's own grant. The day board itself rides `operationsShipment.view`, so a desk
 * reader without the crew grant still sees the van and the captain's name the legacy table
 * printed, but not the van's card or the captain's phone.
 */
const seesCrewPlan = (req: Request): boolean =>
  hasPermission(authContext(req), 'operationsCrew.view');

/** A resolved operating day on the wire: its UTC midnight, as an ISO string. */
const utcDayIso = (d: Date): string =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();

/**
 * The rows and van cards of a board, mapped for THIS reader — the one place the crew plan is
 * taken back out for a reader without `operationsCrew.view`. The day board and the history both
 * answer through it, so a crew fact gated on one can never leak through the other.
 */
const boardForReader = (
  req: Request,
  { rows, crews }: DayBoardView,
): Pick<OperationsDayBoardDto, 'shipments' | 'crews'> => {
  const crewPlan = seesCrewPlan(req);
  return {
    shipments: rows.map(({ doc, origin, destination, crew, captainDeliveredAt }) => ({
      ...toShipmentDto(doc),
      origin,
      destination,
      crew: crew === null || crewPlan ? crew : { ...crew, captainPhone: null },
      captainDeliveredAt: captainDeliveredAt === null ? null : captainDeliveredAt.toISOString(),
    })),
    crews: crewPlan ? crews : [],
  };
};

/** The legacy `/main_ops` board — one day's working set, unioned server-side. */
export const getDayBoard = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsDayBoardQuery>(req);
  const day = query.date ?? new Date();
  const view = await operationsShipmentService.dayBoardView(query.date);
  ok<OperationsDayBoardDto>(res, { date: utcDayIso(day), ...boardForReader(req, view) });
};

/** The shipments history — the day board over `from`..`to`, both inclusive. */
export const getShipmentHistory = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsShipmentHistoryQuery>(req);
  const view = await operationsShipmentService.historyView(query.from, query.to);
  ok<OperationsShipmentHistoryDto>(res, {
    from: utcDayIso(query.from),
    to: utcDayIso(query.to),
    ...boardForReader(req, view),
  });
};

export const getShipment = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toShipmentDto(await operationsShipmentService.getById(params.id)));
};

export const createShipment = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateOperationsShipment>(req);
  const doc = await operationsShipmentService.create(body, authContext(req).userId);
  created(res, toShipmentDto(doc));
};

export const updateShipment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateOperationsShipment, never, IdParam>(req);
  const doc = await operationsShipmentService.update(params.id, body, authContext(req).userId);
  ok(res, toShipmentDto(doc));
};

export const completeShipment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CompleteOperationsShipment, never, IdParam>(req);
  const doc = await operationsShipmentService.complete(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, toShipmentDto(doc));
};

export const reopenShipment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CompleteOperationsShipment, never, IdParam>(req);
  const doc = await operationsShipmentService.reopen(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, toShipmentDto(doc));
};

export const deleteShipment = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await operationsShipmentService.softDelete(params.id, authContext(req).userId);
  noContent(res);
};

export const uploadShipmentReceiptImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const doc = await operationsShipmentService.setReceiptImage(authContext(req), params.id, {
    // Multer reads the part's name as latin1; an Arabic «إيصال ١.jpg» is turned back here, so the
    // Files row, its audit entry and the shipment's `receiptImage.fileName` all keep the real name.
    originalName: receiptImageFileName(uploaded.originalname),
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  ok(res, toShipmentDto(doc));
};

export const getShipmentReceiptImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const image = await operationsShipmentService.readReceiptImage(authContext(req), params.id);
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(image.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(image.buffer);
};

export const deleteShipmentReceiptImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    toShipmentDto(await operationsShipmentService.deleteReceiptImage(authContext(req), params.id)),
  );
};
