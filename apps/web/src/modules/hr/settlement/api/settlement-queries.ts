// TanStack Query hook for the settlement summary (P-HR-11).
//
// No mutation and therefore no invalidation: nothing on this screen can be changed from it. The
// summary reflects four other features, so it is refetched when the tab is opened rather than kept
// warm — a settlement read minutes ago could already be stale if somebody approved an adjustment.
import { useQuery } from '@tanstack/react-query';
import { type QueryParams } from '../../../../shared/lib/api-client';
import * as api from './settlement-api';

const MODULE = 'hr';
const FEATURE = 'settlement';

export const useEmployeeSettlement = (employeeId: string) =>
  useQuery({
    queryKey: [MODULE, FEATURE, employeeId],
    queryFn: () => api.getEmployeeSettlement(employeeId),
    enabled: employeeId !== '',
  });

/** The queue (P-HR-17). `enabled` is the caller's, because it is one view among several. */
export const useSettlementQueue = (params: QueryParams, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'queue', params],
    queryFn: () => api.listSettlementQueue(params),
    enabled,
    placeholderData: (prev) => prev,
  });
