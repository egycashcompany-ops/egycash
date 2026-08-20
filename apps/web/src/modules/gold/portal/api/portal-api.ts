// The customer portal's API calls. Read-only by construction: there is no `post`, `patch` or `del`
// import in this file, and there is nothing on the server that would answer one.
import {
  type GoldFundClosingDto,
  type GoldFundMovementDto,
  type GoldPortalBarDto,
  type GoldPortalDrawerDto,
  type GoldPortalKeyDto,
  type GoldPortalMeDto,
  type GoldPortalOverviewDto,
  type GoldPortalReceiptDto,
  type GoldPortalRepresentativeDto,
  type GoldPortalTransferDto,
  type Paginated,
} from '@ecms/contracts';
import { buildQuery, get, getPage } from '../../../../shared/lib/api-client';

const BASE = '/gold/portal';

export type PortalListParams = { page: number; pageSize: number };

export const fetchPortalMe = (): Promise<GoldPortalMeDto> => get(`${BASE}/me`);

export const fetchPortalOverview = (): Promise<GoldPortalOverviewDto> => get(`${BASE}/overview`);

export const fetchPortalBars = (
  params: PortalListParams & { metalType?: string; search?: string },
): Promise<Paginated<GoldPortalBarDto>> => getPage(`${BASE}/bars${buildQuery(params)}`);

export const fetchPortalDrawers = (): Promise<GoldPortalDrawerDto[]> => get(`${BASE}/drawers`);

export const fetchPortalReceiving = (
  params: PortalListParams,
): Promise<Paginated<GoldPortalReceiptDto>> => getPage(`${BASE}/receiving${buildQuery(params)}`);

export const fetchPortalDelivery = (
  params: PortalListParams,
): Promise<Paginated<GoldPortalReceiptDto>> => getPage(`${BASE}/delivery${buildQuery(params)}`);

export const fetchPortalTransfers = (
  params: PortalListParams,
): Promise<Paginated<GoldPortalTransferDto>> => getPage(`${BASE}/transfers${buildQuery(params)}`);

export const fetchPortalKeys = (
  params: PortalListParams,
): Promise<Paginated<GoldPortalKeyDto>> => getPage(`${BASE}/keys${buildQuery(params)}`);

export const fetchPortalRepresentatives = (
  params: PortalListParams,
): Promise<Paginated<GoldPortalRepresentativeDto>> => getPage(`${BASE}/representatives${buildQuery(params)}`);

export const fetchPortalMovement = (params: {
  metalType: string;
  year: number;
  fromMonth: number;
  toMonth: number;
}): Promise<GoldFundMovementDto> => get(`${BASE}/reports/movement${buildQuery(params)}`);

export const fetchPortalClosing = (params: {
  metalType: string;
}): Promise<GoldFundClosingDto> => get(`${BASE}/reports/closing${buildQuery(params)}`);
