// TanStack Query hooks for the customer portal.
//
// Queries only — there is no mutation hook in this file and no endpoint that would accept one.
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
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
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './portal-api';

const MODULE = 'gold';
const FEATURE = 'portal';

export const useGoldPortalMe = (): UseQueryResult<GoldPortalMeDto> =>
  useQuery({ queryKey: detailKey(MODULE, FEATURE, 'me'), queryFn: api.fetchPortalMe });

export const useGoldPortalOverview = (): UseQueryResult<GoldPortalOverviewDto> =>
  useQuery({ queryKey: detailKey(MODULE, FEATURE, 'overview'), queryFn: api.fetchPortalOverview });

export const useGoldPortalBars = (
  params: api.PortalListParams & { metalType?: string; search?: string },
): UseQueryResult<Paginated<GoldPortalBarDto>> =>
  useQuery({
    queryKey: listKey(MODULE, `${FEATURE}-bars`, params),
    queryFn: () => api.fetchPortalBars(params),
  });

export const useGoldPortalDrawers = (): UseQueryResult<GoldPortalDrawerDto[]> =>
  useQuery({ queryKey: listKey(MODULE, `${FEATURE}-drawers`, {}), queryFn: api.fetchPortalDrawers });

export const useGoldPortalReceiving = (
  params: api.PortalListParams,
): UseQueryResult<Paginated<GoldPortalReceiptDto>> =>
  useQuery({
    queryKey: listKey(MODULE, `${FEATURE}-receiving`, params),
    queryFn: () => api.fetchPortalReceiving(params),
  });

export const useGoldPortalDelivery = (
  params: api.PortalListParams,
): UseQueryResult<Paginated<GoldPortalReceiptDto>> =>
  useQuery({
    queryKey: listKey(MODULE, `${FEATURE}-delivery`, params),
    queryFn: () => api.fetchPortalDelivery(params),
  });

export const useGoldPortalTransfers = (
  params: api.PortalListParams,
): UseQueryResult<Paginated<GoldPortalTransferDto>> =>
  useQuery({
    queryKey: listKey(MODULE, `${FEATURE}-transfers`, params),
    queryFn: () => api.fetchPortalTransfers(params),
  });

export const useGoldPortalKeys = (
  params: api.PortalListParams,
): UseQueryResult<Paginated<GoldPortalKeyDto>> =>
  useQuery({
    queryKey: listKey(MODULE, `${FEATURE}-keys`, params),
    queryFn: () => api.fetchPortalKeys(params),
  });

export const useGoldPortalRepresentatives = (
  params: api.PortalListParams,
): UseQueryResult<Paginated<GoldPortalRepresentativeDto>> =>
  useQuery({
    queryKey: listKey(MODULE, `${FEATURE}-representatives`, params),
    queryFn: () => api.fetchPortalRepresentatives(params),
  });

export const useGoldPortalMovement = (params: {
  metalType: string;
  year: number;
  fromMonth: number;
  toMonth: number;
}): UseQueryResult<GoldFundMovementDto> =>
  useQuery({
    queryKey: listKey(MODULE, `${FEATURE}-movement`, params),
    queryFn: () => api.fetchPortalMovement(params),
  });

export const useGoldPortalClosing = (params: {
  metalType: string;
}): UseQueryResult<GoldFundClosingDto> =>
  useQuery({
    queryKey: listKey(MODULE, `${FEATURE}-closing`, params),
    queryFn: () => api.fetchPortalClosing(params),
  });
