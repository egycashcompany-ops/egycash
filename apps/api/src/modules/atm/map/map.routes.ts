// /atm/map — the machine map, its zones and the machines' locations
// (docs/12-planning/atm-map-zones.md §6.3).
//
// authenticate → gate → (rate limit) → validate. `authorize` takes one key, so a route that needs
// two chains two: every `/locations/*` and `/machines/*` route asks `atmMachine.locate` AND
// `atmMap.view`, because each returns coordinates or counts of the map. Literal paths are declared
// before `/:machineId`. The three per-user limits (DM-47) count calls that passed the gate.
import { type Request, Router } from 'express';
import { z } from 'zod';
import {
  ApproveAtmMachineLocationSchema,
  AtmMapLocationSummaryQuerySchema,
  AtmMapPointsQuerySchema,
  AtmMapZonesQuerySchema,
  ParseAtmMapLocationSchema,
  PlaceAtmMachineLocationSchema,
  ResolveAtmMapLinksSchema,
  SaveAtmMapZoneSetSchema,
  SyncAtmMapLocationsSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate, authContextOrNull } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { rateLimit } from '../../../infrastructure/redis/rate-limiter';
import {
  approveMachineLocation,
  getMachineLocation,
  getMapContext,
  listMapPoints,
  listMapZones,
  parseMapLocation,
  placeMachineLocation,
  resolveMapLinks,
  saveMapZones,
  summarizeMapLocations,
  syncMapLocations,
} from './map.controller';

const MachineIdParamSchema = z.object({ machineId: objectId() }).strict();

const perUser = (req: Request): string | null => authContextOrNull(req)?.userId ?? null;

export const buildAtmMapRouter = (): Router => {
  const router = Router();
  const locate = [authenticate, authorize('atmMachine.locate'), authorize('atmMap.view')];

  router.get('/context', authenticate, authorize('atmMap.view'), asyncHandler(getMapContext));
  router.get(
    '/points',
    authenticate,
    authorize('atmMap.view'),
    validate({ query: AtmMapPointsQuerySchema }),
    asyncHandler(listMapPoints),
  );
  router.get(
    '/zones',
    authenticate,
    authorize('atmMap.view'),
    validate({ query: AtmMapZonesQuerySchema }),
    asyncHandler(listMapZones),
  );
  router.put(
    '/zones',
    authenticate,
    authorize('atmZone.manage'),
    rateLimit({ name: 'atm-map-zone-save', windowSeconds: 60, max: 30, keyOf: perUser }),
    validate({ body: SaveAtmMapZoneSetSchema }),
    asyncHandler(saveMapZones),
  );

  router.get(
    '/locations/summary',
    ...locate,
    validate({ query: AtmMapLocationSummaryQuerySchema }),
    asyncHandler(summarizeMapLocations),
  );
  // Always 200: `ok: false` is a result, not an error. A short link is never fetched here.
  router.post(
    '/locations/parse',
    ...locate,
    validate({ body: ParseAtmMapLocationSchema }),
    asyncHandler(parseMapLocation),
  );
  router.post(
    '/locations/sync',
    ...locate,
    rateLimit({ name: 'atm-map-sync', windowSeconds: 60, max: 6, keyOf: perUser }),
    validate({ body: SyncAtmMapLocationsSchema }),
    asyncHandler(syncMapLocations),
  );
  router.post(
    '/locations/resolve-links',
    ...locate,
    rateLimit({ name: 'atm-map-resolve', windowSeconds: 60, max: 10, keyOf: perUser }),
    validate({ body: ResolveAtmMapLinksSchema }),
    asyncHandler(resolveMapLinks),
  );

  router.get(
    '/machines/:machineId/location',
    ...locate,
    validate({ params: MachineIdParamSchema }),
    asyncHandler(getMachineLocation),
  );
  router.put(
    '/machines/:machineId/location',
    ...locate,
    validate({ body: PlaceAtmMachineLocationSchema, params: MachineIdParamSchema }),
    asyncHandler(placeMachineLocation),
  );
  router.post(
    '/machines/:machineId/location/approve',
    ...locate,
    validate({ body: ApproveAtmMachineLocationSchema, params: MachineIdParamSchema }),
    asyncHandler(approveMachineLocation),
  );
  return router;
};
