// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type AssignShipmentPickupLeg,
  type OperationsCaptainRouteQuery,
  type ReorderCaptainShipments,
} from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toShipmentAssignmentDto } from '../operations.mappers';
import { operationsAssignmentService } from './assignment.service';

type IdParam = { id: string };

export const assignPickupLeg = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AssignShipmentPickupLeg, never, IdParam>(req);
  const doc = await operationsAssignmentService.assignPickupLeg(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, toShipmentAssignmentDto(doc));
};

export const reorderCaptainShipments = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ReorderCaptainShipments>(req);
  const outcome = await operationsAssignmentService.reorder(body, authContext(req).userId);
  // A write answers with the refreshed route in the same round-trip (the roster convention).
  const route = await operationsAssignmentService.captainRoute(
    body.date,
    body.captainEmployeeId,
    body.leg,
  );
  ok(res, { ...route, reordered: outcome.reordered });
};

export const getCaptainRoute = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsCaptainRouteQuery>(req);
  ok(
    res,
    await operationsAssignmentService.captainRoute(query.date, query.captainEmployeeId, query.leg),
  );
};
