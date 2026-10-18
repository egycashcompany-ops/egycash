// TanStack Query hooks for the machine map (ADR-013; docs/12-planning/atm-map-zones.md §8.2). Keys
// follow the platform factory — ['atm', feature, kind, params] — and say the same thing the realtime
// registry says for the `atm.mapZone` and `atm.machineLocation` topics (§6.7), so a write here and
// a write somebody else made go stale identically.
//
// Invalidation facts worth stating:
//   · a zone save stales the zones and nothing else — membership is computed in the browser from
//     the zones and the points it already holds (DM-9), so the points did not move;
//   · every location write (place, approve, sync, link resolution) stales the points, the
//     unlocated screen's summary and the open location details: a pin that moved changes all three.
//
// THE ORDER OF THE READS (§8.3). `context` loads first, and the points and zones queries take an
// `enabled` the page derives from it, so a branch remembered by another account on this browser,
// or left from an earlier top-bar choice, is pruned before it can reach the server as a 400.
//
// Every mutation declares `onError`, which opts it out of the global toast
// (`shared/lib/query-client.ts`): each caller maps its own refusals (§8.10) — a stale zone set opens
// the conflict dialog, a stale pin refetches its detail — and the global handler would add a second
// toast with the server's English sentence. One failure, one message.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ApproveAtmMachineLocation,
  type ParseAtmMapLocation,
  type PlaceAtmMachineLocation,
  type ResolveAtmMapLinks,
  type SaveAtmMapZoneSetInput,
  type SyncAtmMapLocations,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './map-api';
import { type MapBranchParams, type MapPointsParams } from './map-api';

const MODULE = 'atm';

/** The map's key families — also the prefixes the realtime registry names. */
export const mapKeys = {
  context: featureKey(MODULE, 'mapContext'),
  points: featureKey(MODULE, 'mapPoints'),
  zones: featureKey(MODULE, 'mapZones'),
  summary: featureKey(MODULE, 'mapLocationSummary'),
  location: featureKey(MODULE, 'mapLocation'),
};

export const mapContextKey = (): readonly unknown[] => listKey(MODULE, 'mapContext');
export const mapPointsKey = ({ branchId, status }: MapPointsParams): readonly unknown[] =>
  listKey(MODULE, 'mapPoints', { branchId, status });
export const mapZonesKey = ({ branchId }: MapBranchParams): readonly unknown[] =>
  listKey(MODULE, 'mapZones', { branchId });
export const mapLocationSummaryKey = ({ branchId }: MapBranchParams): readonly unknown[] =>
  listKey(MODULE, 'mapLocationSummary', { branchId });
export const mapLocationKey = (machineId: string): readonly unknown[] =>
  detailKey(MODULE, 'mapLocation', machineId);

type QueryClientLike = ReturnType<typeof useQueryClient>;

const invalidateLocations = (client: QueryClientLike): void => {
  void client.invalidateQueries({ queryKey: mapKeys.points });
  void client.invalidateQueries({ queryKey: mapKeys.summary });
  void client.invalidateQueries({ queryKey: mapKeys.location });
};

const reportedByCaller = (): void => undefined;

// ── Reads ───────────────────────────────────────────────────────────────────
export const useMapContext = (enabled = true) =>
  useQuery({
    queryKey: mapContextKey(),
    queryFn: () => api.getMapContext(),
    enabled,
  });

/** Enabled only once `context` has resolved and the branch has been checked against it (§8.3). */
export const useMapPoints = (params: MapPointsParams, enabled: boolean) =>
  useQuery({
    queryKey: mapPointsKey(params),
    queryFn: () => api.getMapPoints(params),
    enabled,
  });

export const useMapZones = (params: MapBranchParams, enabled: boolean) =>
  useQuery({
    queryKey: mapZonesKey(params),
    queryFn: () => api.getMapZones(params),
    enabled,
  });

export const useMapLocationSummary = (params: MapBranchParams, enabled: boolean) =>
  useQuery({
    queryKey: mapLocationSummaryKey(params),
    queryFn: () => api.getMapLocationSummary(params),
    enabled,
  });

/** Fetched when a pin is about to move or be approved: the point DTO carries no `version`. */
export const useMachineLocation = (machineId: string | null) =>
  useQuery({
    queryKey: mapLocationKey(machineId ?? ''),
    queryFn: () => api.getMachineLocation(machineId ?? ''),
    enabled: machineId !== null && machineId !== '',
  });

// ── Zones ───────────────────────────────────────────────────────────────────
export const useSaveZoneSet = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveAtmMapZoneSetInput) => api.saveZoneSet(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: mapKeys.zones });
    },
    onError: reportedByCaller,
  });
};

// ── Locations ───────────────────────────────────────────────────────────────
/**
 * The paste box's preview. A mutation, never a query, and `gcTime: 0`, so a pasted text is not kept
 * in any cache once the box has shown its answer. Nothing is invalidated: a parse writes nothing.
 */
export const useParseLocation = () =>
  useMutation({
    mutationFn: (body: ParseAtmMapLocation) => api.parseLocation(body),
    gcTime: 0,
    onError: reportedByCaller,
  });

export const usePlaceLocation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, body }: { machineId: string; body: PlaceAtmMachineLocation }) =>
      api.placeLocation(machineId, body),
    onSuccess: () => invalidateLocations(client),
    onError: reportedByCaller,
  });
};

export const useApproveLocation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, body }: { machineId: string; body: ApproveAtmMachineLocation }) =>
      api.approveLocation(machineId, body),
    onSuccess: () => invalidateLocations(client),
    onError: reportedByCaller,
  });
};

export const useSyncLocations = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SyncAtmMapLocations) => api.syncLocations(body),
    onSuccess: () => invalidateLocations(client),
    onError: reportedByCaller,
  });
};

/** One call of the resolve loop (§8.10); the loop itself is the caller's. */
export const useResolveLinks = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ResolveAtmMapLinks) => api.resolveLinks(body),
    onSuccess: () => invalidateLocations(client),
    onError: reportedByCaller,
  });
};
