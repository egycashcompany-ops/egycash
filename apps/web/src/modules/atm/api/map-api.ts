// Machine map api/ surface (ADR-013, the `atm-api.ts` shape): one typed function per endpoint of
// `/atm/map` (docs/12-planning/atm-map-zones.md §6.3, §8.2) — no mock data, no client-side rules.
// What the map decides — whose machines are in reach, which branch a zone save is filed under,
// where a pasted text puts a machine — is decided by the server; this file only carries it.
//
// Three calls are shaped by the spec rather than by REST habit:
//   · the parse is a POST even though it writes nothing: the pasted text is the person's input,
//     not an address, and it never belongs in a URL, a log line or the query cache (DM-14);
//   · `branchId` on the reads only NARROWS inside the caller's reach (DM-11) — the page sends it
//     only after `context` has said the branch is offered (§8.3);
//   · the zone save carries the revision the editor loaded; a newer one on the server is 409
//     `ATM_MAP_ZONES_STALE`, and nothing is written (DM-7).
import {
  type AtmMachineLocationDetailDto,
  type AtmMapContextDto,
  type AtmMapLinkResolveResultDto,
  type AtmMapLocationSummaryDto,
  type AtmMapParseResultDto,
  type AtmMapPointsDto,
  type AtmMapStatusFilter,
  type AtmMapSyncResultDto,
  type AtmMapZoneSetDto,
  type AtmMapZonesDto,
  type ApproveAtmMachineLocation,
  type ParseAtmMapLocation,
  type PlaceAtmMachineLocation,
  type ResolveAtmMapLinks,
  type SaveAtmMapZoneSetInput,
  type SyncAtmMapLocations,
} from '@ecms/contracts';
import { buildQuery, get, post, put } from '../../../shared/lib/api-client';

const BASE = '/atm/map';

/** A read narrowed to one branch, or every branch in reach when `null` («كل الفروع»). */
export interface MapBranchParams {
  branchId: string | null;
}

export interface MapPointsParams extends MapBranchParams {
  status: AtmMapStatusFilter;
}

const branchQuery = (branchId: string | null): string =>
  buildQuery({ branchId: branchId ?? undefined });

// ── Reads ───────────────────────────────────────────────────────────────────
/** The branches in reach, what the caller may do in each, and where a zone save is filed. */
export const getMapContext = (): Promise<AtmMapContextDto> =>
  get<AtmMapContextDto>(`${BASE}/context`);

/** Every machine in reach — not paginated, the lean endpoint `MAX_PAGE_SIZE` cannot serve. */
export const getMapPoints = ({ branchId, status }: MapPointsParams): Promise<AtmMapPointsDto> =>
  get<AtmMapPointsDto>(`${BASE}/points${buildQuery({ branchId: branchId ?? undefined, status })}`);

export const getMapZones = ({ branchId }: MapBranchParams): Promise<AtmMapZonesDto> =>
  get<AtmMapZonesDto>(`${BASE}/zones${branchQuery(branchId)}`);

export const getMapLocationSummary = ({
  branchId,
}: MapBranchParams): Promise<AtmMapLocationSummaryDto> =>
  get<AtmMapLocationSummaryDto>(`${BASE}/locations/summary${branchQuery(branchId)}`);

/** One machine's location, with the `version` a placement or an approval must carry. */
export const getMachineLocation = (machineId: string): Promise<AtmMachineLocationDetailDto> =>
  get<AtmMachineLocationDetailDto>(`${BASE}/machines/${machineId}/location`);

// ── Zones ───────────────────────────────────────────────────────────────────
/** Every change of the edit branch's zones, in one request (DM-7, DM-12). */
export const saveZoneSet = (body: SaveAtmMapZoneSetInput): Promise<AtmMapZoneSetDto> =>
  put<AtmMapZoneSetDto>(`${BASE}/zones`, body);

// ── Locations ───────────────────────────────────────────────────────────────
/** The paste box's preview. Always 200: `ok: false` is a result, not an error. */
export const parseLocation = (body: ParseAtmMapLocation): Promise<AtmMapParseResultDto> =>
  post<AtmMapParseResultDto>(`${BASE}/locations/parse`, body);

export const placeLocation = (
  machineId: string,
  body: PlaceAtmMachineLocation,
): Promise<AtmMachineLocationDetailDto> =>
  put<AtmMachineLocationDetailDto>(`${BASE}/machines/${machineId}/location`, body);

export const approveLocation = (
  machineId: string,
  body: ApproveAtmMachineLocation,
): Promise<AtmMachineLocationDetailDto> =>
  post<AtmMachineLocationDetailDto>(`${BASE}/machines/${machineId}/location/approve`, body);

/** Re-derive every active machine in the writable scope from the register's AP/AV text. */
export const syncLocations = (body: SyncAtmMapLocations): Promise<AtmMapSyncResultDto> =>
  post<AtmMapSyncResultDto>(`${BASE}/locations/sync`, body);

/** One batch of short links, opened once each by the server (D-M4, DM-46). */
export const resolveLinks = (body: ResolveAtmMapLinks): Promise<AtmMapLinkResolveResultDto> =>
  post<AtmMapLinkResolveResultDto>(`${BASE}/locations/resolve-links`, body);
