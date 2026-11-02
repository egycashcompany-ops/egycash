// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ApproveFleetFuelCharge,
  type CreateFleetFuelCard,
  type FleetFuelCardSummaryQuery,
  type ListFleetFuelCardMovementsQuery,
  type ListFleetFuelCardsQuery,
  type RequestFleetFuelCharge,
  type TransferFleetFuelBalance,
  type TransferFleetFuelBatch,
  type UpdateFleetFuelCardMovement,
  type UpdateFleetFuelCard,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { ValidationError } from '../../../shared/errors';
import { authContext } from '../../../platform/auth';
import { fleetFuelCardService, toFuelCardDto, toFuelMovementDto } from './fuel-card.service';
import { thumbRequired } from './fuel-card-thumbs';
import { partOf } from './fuel-card-upload';

type IdParam = { id: string };

export const listFuelCards = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetFuelCardsQuery>(req);
  const { codes, ...page } = await fleetFuelCardService.list(query);
  okPage(res, page, (doc) =>
    toFuelCardDto({ doc, vehicleCode: codes.get(String(doc.vehicleId)) ?? null }),
  );
};

export const fuelCardSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetFuelCardSummaryQuery>(req);
  ok(res, await fleetFuelCardService.summary(query));
};

export const getFuelCard = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toFuelCardDto(await fleetFuelCardService.get(params.id)));
};

export const revealFuelCardPassword = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  res.setHeader('Cache-Control', 'private, no-store');
  ok(res, { password: await fleetFuelCardService.reveal(params.id) });
};

export const createFuelCard = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetFuelCard>(req);
  created(res, toFuelCardDto(await fleetFuelCardService.create(body, authContext(req).userId)));
};

export const updateFuelCard = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetFuelCard, never, IdParam>(req);
  ok(
    res,
    toFuelCardDto(await fleetFuelCardService.update(params.id, body, authContext(req).userId)),
  );
};

export const deleteFuelCard = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetFuelCardService.remove(params.id, authContext(req).userId);
  noContent(res);
};

export const requestFuelCharge = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<RequestFleetFuelCharge, never, IdParam>(req);
  ok(
    res,
    toFuelCardDto(await fleetFuelCardService.request(params.id, body, authContext(req).userId)),
  );
};

export const approveFuelCharge = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ApproveFleetFuelCharge, never, IdParam>(req);
  ok(
    res,
    toFuelCardDto(await fleetFuelCardService.approve(params.id, body, authContext(req).userId)),
  );
};

export const transferFuelBalance = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<TransferFleetFuelBalance>(req);
  ok(res, await fleetFuelCardService.transfer(body, authContext(req).userId));
};

export const transferFuelBatch = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<TransferFleetFuelBatch>(req);
  ok(res, await fleetFuelCardService.transferBatch(body, authContext(req).userId));
};

export const listFuelCardMovements = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetFuelCardMovementsQuery>(req);
  const { numbers, receiptCars, names, ...page } = await fleetFuelCardService.movements(query);
  okPage(res, page, (doc) =>
    toFuelMovementDto(
      doc,
      doc.counterpartCardId == null ? null : (numbers.get(String(doc.counterpartCardId)) ?? null),
      doc.receiptId == null ? null : (receiptCars.get(String(doc.receiptId)) ?? null),
      doc.createdBy == null ? null : (names.get(String(doc.createdBy)) ?? null),
      doc.cancelledBySheet?.by == null
        ? null
        : (names.get(String(doc.cancelledBySheet.by)) ?? null),
    ),
  );
};

export const updateFuelCardMovement = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetFuelCardMovement, never, IdParam>(req);
  const line = await fleetFuelCardService.changeMovement(authContext(req), params.id, body.amount);
  if (line === null) {
    noContent(res);
    return;
  }
  ok(res, toFuelMovementDto(line, null));
};

export const deleteFuelCardMovement = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetFuelCardService.changeMovement(authContext(req), params.id, null);
  noContent(res);
};

const binaryOf = (part: Express.Multer.File) => ({
  originalName: part.originalname,
  mime: part.mimetype,
  size: part.size,
  buffer: part.buffer,
});

/** The photo, and — when the browser made one — its thumbnail beside it (`thumb`). */
export const uploadFuelCardImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const uploaded = partOf(req, 'file');
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const thumb = partOf(req, 'thumb');
  const card = await fleetFuelCardService.setImage(
    authContext(req),
    params.id,
    binaryOf(uploaded),
    thumb === undefined ? null : binaryOf(thumb),
  );
  ok(res, toFuelCardDto(card));
};

/** A thumbnail for the photo the card already has (6d back-fill). */
export const uploadFuelCardThumb = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const thumb = partOf(req, 'thumb');
  if (thumb === undefined) throw thumbRequired();
  ok(
    res,
    toFuelCardDto(
      await fleetFuelCardService.setThumb(authContext(req), params.id, binaryOf(thumb)),
    ),
  );
};

/** The photo's thumbnail — what every reader of the cards may see. */
export const getFuelCardImageThumb = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const thumb = await fleetFuelCardService.readThumb(authContext(req), params.id);
  res.setHeader('Content-Type', thumb.mime);
  res.setHeader('Content-Disposition', 'inline; filename="thumb"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(thumb.buffer);
};

export const getFuelCardImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const image = await fleetFuelCardService.readImage(authContext(req), params.id);
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(image.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(image.buffer);
};

export const deleteFuelCardImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toFuelCardDto(await fleetFuelCardService.deleteImage(authContext(req), params.id)));
};
