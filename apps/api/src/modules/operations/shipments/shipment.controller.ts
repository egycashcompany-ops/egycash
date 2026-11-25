// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CompleteOperationsShipment,
  type ConfirmOperationsDelivery,
  type CreateOperationsShipment,
  type ListOperationsShipmentsQuery,
  type OperationsDayBoardDto,
  type OperationsDayBoardQuery,
  type OperationsDeliveredBoardDto,
  type OperationsDeliveredBoardQuery,
  type OperationsDeliveredShipmentDto,
  type OperationsDeliveryConfirmationResultDto,
  type OperationsDeletedShipmentsDto,
  type OperationsDeletedShipmentsQuery,
  type OperationsShipmentHistoryDto,
  type OperationsShipmentHistoryQuery,
  type OperationsShipmentLogDto,
  type UndoOperationsDelivery,
  type UpdateOperationsShipment,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { hasPermission } from '../../../shared/types';
import { toShipmentDto } from '../operations.mappers';
import { boardForReader, utcDayIso } from './board-for-reader';
import { receiptImageFileName } from './receipt-image-upload';
import { operationsShipmentService } from './shipment.service';
import { operationsDeliveryConfirmationService } from './delivery-confirmation.service';
import { type OperationsShipmentDoc } from './shipment.model';

type IdParam = { id: string };

export const listShipments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsShipmentsQuery>(req);
  okPage(res, await operationsShipmentService.list(query), toShipmentDto);
};

/** The legacy `/main_ops` board — one day's working set, unioned server-side. */
export const getDayBoard = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsDayBoardQuery>(req);
  // The day the SERVICE resolves — today in Cairo when none is asked for — resolved ONCE and read
  // with, so the echoed date is always the day whose rows came back (two reads of the clock would
  // disagree on a request that straddles Cairo midnight).
  const day = operationsShipmentService.boardDay(query.date);
  const view = await operationsShipmentService.dayBoardView(day);
  ok<OperationsDayBoardDto>(res, { date: utcDayIso(day), ...boardForReader(req, view) });
};

/**
 * Round 33 B — «الشحنات المسلَّمة»: the shipments delivered to their bank on one Cairo day (today when
 * none is asked for), the day board's rows mapped for this reader, each with its delivery
 * confirmation. The day is resolved ONCE and echoed, as the day board's.
 */
export const getDeliveredBoard = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsDeliveredBoardQuery>(req);
  // Today is read ONCE and the day asked resolved against it, so a request straddling Cairo
  // midnight never answers one day while calling another today (Round 33 critic: the screen trusts
  // this `today`, never its PC's clock).
  const today = operationsDeliveryConfirmationService.dayOf(undefined);
  const view = await operationsDeliveryConfirmationService.deliveredView(query.date ?? today);
  const board = boardForReader(req, view);
  const confirmations = await operationsDeliveryConfirmationService.confirmationsOf(
    view.rows.map(({ doc }) => doc),
  );
  ok<OperationsDeliveredBoardDto>(res, {
    date: view.date,
    today,
    // Every row kept was delivered (the service keeps no other), so its instant is always there.
    shipments: board.shipments.flatMap((row): OperationsDeliveredShipmentDto[] =>
      row.captainDeliveredAt === null
        ? []
        : [
            {
              ...row,
              captainDeliveredAt: row.captainDeliveredAt,
              deliveryConfirmation: confirmations.get(row.id) ?? null,
            },
          ],
    ),
    crews: board.crews,
  });
};

/** The ✓ and its undo answer with the shipment's new version and its confirmation now. */
const confirmationResult = async (
  doc: OperationsShipmentDoc,
): Promise<OperationsDeliveryConfirmationResultDto> => ({
  shipmentId: String(doc._id),
  version: doc.__v,
  deliveryConfirmation:
    (await operationsDeliveryConfirmationService.confirmationsOf([doc])).get(String(doc._id)) ??
    null,
});

/** Round 33 B — «الشحنات المسلَّمة»'s ✓: the person is the token's, the bank billed the server's. */
export const confirmShipmentDelivery = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ConfirmOperationsDelivery, never, IdParam>(req);
  const doc = await operationsDeliveryConfirmationService.confirm(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, await confirmationResult(doc));
};

/** Round 33 B — «إلغاء التأكيد». */
export const undoShipmentDelivery = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UndoOperationsDelivery, never, IdParam>(req);
  const doc = await operationsDeliveryConfirmationService.undo(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, await confirmationResult(doc));
};

/**
 * The shipments history over `from`..`to`, both inclusive — the dailies collected in it and every
 * secured shipment collected or delivered in it («شحنات ومحصنات»), or one of the two with `type`
 * (Round 12 — «سجل الخزينة» asks for the محصنات alone).
 */
export const getShipmentHistory = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsShipmentHistoryQuery>(req);
  const view = await operationsShipmentService.historyView(query.from, query.to, query.type);
  ok<OperationsShipmentHistoryDto>(res, {
    from: utcDayIso(query.from),
    to: utcDayIso(query.to),
    ...boardForReader(req, view),
  });
};

/**
 * The deleted shipments of `from`..`to` — the history's rows that were deleted, each with when and
 * by whom, mapped for this reader through the same `boardForReader` as the history.
 */
export const getDeletedShipments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsDeletedShipmentsQuery>(req);
  const view = await operationsShipmentService.deletedView(query.from, query.to, query.type);
  const board = boardForReader(req, view);
  const docOf = new Map(view.rows.map(({ doc }) => [String(doc._id), doc]));
  ok<OperationsDeletedShipmentsDto>(res, {
    from: utcDayIso(query.from),
    to: utcDayIso(query.to),
    shipments: board.shipments.map((row) => {
      const deletedAt = docOf.get(row.id)?.deletedAt;
      return {
        ...row,
        // Every row of this list was read on `isDeleted: true`, which the delete stamps together
        // with `deletedAt`; `updatedAt` stands in only for a row deleted by hand without one.
        deletedAt: deletedAt == null ? row.updatedAt : deletedAt.toISOString(),
        deletedByName: view.deletedByName.get(row.id) ?? null,
      };
    }),
    crews: board.crews,
  });
};

/**
 * The shipment's action log — every recorded act on it, oldest first (deleted ones answer too).
 *
 * The vault's own record — the receipt number, the package counts, the seals and the two
 * treasurers — is the treasury's, behind `operationsVault.view` like the vault screens and the
 * custody's realtime topic. A reader without it still sees that the shipment entered the vault
 * and left it (its own status moves), just not what the treasury wrote down.
 */
export const getShipmentLog = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const seesVault = hasPermission(authContext(req), 'operationsVault.view');
  ok<OperationsShipmentLogDto>(res, await operationsShipmentService.log(params.id, { seesVault }));
};

export const restoreShipment = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    toShipmentDto(await operationsShipmentService.restore(params.id, authContext(req).userId)),
  );
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
