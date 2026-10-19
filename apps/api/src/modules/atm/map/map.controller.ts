// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ApproveAtmMachineLocation,
  type AtmMapLocationSummaryQuery,
  type AtmMapPointsQuery,
  type AtmMapZonesQuery,
  type ParseAtmMapLocation,
  type PlaceAtmMachineLocation,
  type ResolveAtmMapLinks,
  type SaveAtmMapZoneSet,
  type SyncAtmMapLocations,
} from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { atmMachineLocationService } from './location.service';
import { atmMapService } from './map.service';
import { atmMapZoneService } from './zone.service';

export const getMapContext = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmMapService.context(authContext(req)));
};

export const listMapPoints = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmMapPointsQuery>(req);
  ok(res, await atmMapService.points(query, authContext(req)));
};

export const listMapZones = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmMapZonesQuery>(req);
  ok(res, await atmMapService.zones(query, authContext(req)));
};

export const saveMapZones = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveAtmMapZoneSet>(req);
  ok(res, await atmMapZoneService.save(body, authContext(req)));
};

export const summarizeMapLocations = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmMapLocationSummaryQuery>(req);
  ok(res, await atmMapService.summary(query, authContext(req)));
};

export const parseMapLocation = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ParseAtmMapLocation>(req);
  ok(res, await atmMachineLocationService.parse(body, authContext(req)));
};

export const syncMapLocations = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SyncAtmMapLocations>(req);
  ok(res, await atmMachineLocationService.sync(body, authContext(req)));
};

export const resolveMapLinks = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ResolveAtmMapLinks>(req);
  ok(res, await atmMachineLocationService.resolveLinks(body, authContext(req)));
};

export const getMachineLocation = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { machineId: string }>(req);
  ok(res, await atmMachineLocationService.detail(params.machineId, authContext(req)));
};

export const placeMachineLocation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<PlaceAtmMachineLocation, never, { machineId: string }>(req);
  ok(res, await atmMachineLocationService.place(params.machineId, body, authContext(req)));
};

export const approveMachineLocation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ApproveAtmMachineLocation, never, { machineId: string }>(req);
  ok(res, await atmMachineLocationService.approve(params.machineId, body, authContext(req)));
};
