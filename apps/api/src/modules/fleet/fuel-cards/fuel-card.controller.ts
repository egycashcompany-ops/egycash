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
  type UpdateFleetFuelCardMovement,
  type UpdateFleetFuelCard,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { ValidationError } from '../../../shared/errors';
import { authContext } from '../../../platform/auth';
import { fleetFuelCardService, toFuelCardDto, toFuelMovementDto } from './fuel-card.service';

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

export const listFuelCardMovements = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetFuelCardMovementsQuery>(req);
  const { numbers, ...page } = await fleetFuelCardService.movements(query);
  okPage(res, page, (doc) =>
    toFuelMovementDto(
      doc,
      doc.counterpartCardId == null ? null : (numbers.get(String(doc.counterpartCardId)) ?? null),
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

export const uploadFuelCardImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const card = await fleetFuelCardService.setImage(authContext(req), params.id, {
    originalName: uploaded.originalname,
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  ok(res, toFuelCardDto(card));
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
