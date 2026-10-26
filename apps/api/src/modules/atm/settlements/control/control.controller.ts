// Thin HTTP mapping only (ADR-003) — /atm/control (docs/12-planning/atm-settlements-phase1.md §6.3
// C1–C7).
import { type Request, type Response } from 'express';
import {
  type AssignAtmRoutes,
  type AtmControlPrint,
  type AtmRoutesFromZones,
  type AtmSettlementDayQuery,
  type AtmVersionQuery,
  type CreateAtmRoute,
  type UpdateAtmRoute,
} from '@ecms/contracts';
import { authContext } from '../../../../platform/auth';
import { noContent, ok, validated } from '../../../../platform/web';
import { atmSettlementPrintService } from '../prints/print.service';
import { atmControlService } from './control.service';

export const getControlDay = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmSettlementDayQuery>(req);
  ok(res, await atmControlService.day(query, authContext(req)));
};

export const createRoute = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateAtmRoute>(req);
  ok(res, await atmControlService.createRoute(body, authContext(req)));
};

export const routesFromZones = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AtmRoutesFromZones>(req);
  ok(res, await atmControlService.fromZones(body, authContext(req)));
};

export const updateRoute = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmRoute, never, { routeId: string }>(req);
  ok(res, await atmControlService.updateRoute(params.routeId, body, authContext(req)));
};

export const deleteRoute = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, AtmVersionQuery, { routeId: string }>(req);
  await atmControlService.deleteRoute(params.routeId, query.version, authContext(req));
  noContent(res);
};

export const assignRoutes = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AssignAtmRoutes>(req);
  ok(res, await atmControlService.assign(body, authContext(req)));
};

export const printControl = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AtmControlPrint>(req);
  ok(res, await atmSettlementPrintService.controlPrint(body, authContext(req)));
};
