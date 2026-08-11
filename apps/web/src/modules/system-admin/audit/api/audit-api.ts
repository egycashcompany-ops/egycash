// The two log streams' client surface (P11).
//
// Both endpoints already existed, already authorized and already audited — the System
// Administration plan named these screens as a later phase and guarded their routes until the work
// arrived. This slice adds the surface and nothing else: no endpoint, no permission, no setting.
//
// **Read-only, and there is nothing to invalidate.** Both streams are append-only: no screen writes
// to them, so no mutation exists to invalidate a cache after. What a reader wants instead is not to
// be handed a stale page, so the queries carry a short `staleTime` rather than the long one a
// catalog would use.
import { useQuery } from '@tanstack/react-query';
import { type ActivityLogDto, type AuditLogDto, type Paginated } from '@ecms/contracts';
import { downloadBlob, getPage } from '../../../../shared/lib/api-client';
import { type ActivityScreenFilters, type AuditScreenFilters } from '../lib/audit-filters';

export const AUDIT_KEY = ['platform', 'audit-logs'] as const;
export const ACTIVITY_KEY = ['platform', 'activity-logs'] as const;

/** Only the parameters the endpoint declares — an undeclared one is a 400, by design. */
const toSearch = (query: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
};

const listAuditLogs = (filters: AuditScreenFilters): Promise<Paginated<AuditLogDto>> =>
  getPage<AuditLogDto>(
    `/platform/audit-logs${toSearch({
      page: filters.page,
      pageSize: filters.pageSize,
      entityType: filters.entityType,
      entityId: filters.entityId,
      actorUserId: filters.actorUserId,
      action: filters.action,
      moduleId: filters.moduleId,
      from: filters.from,
      to: filters.to,
    })}`,
  );

export const useAuditLogs = (filters: AuditScreenFilters) =>
  useQuery({
    queryKey: [...AUDIT_KEY, 'list', filters],
    queryFn: () => listAuditLogs(filters),
    staleTime: 15_000,
  });

/**
 * The CSV, through the shared download seam.
 *
 * A separate permission from reading (`auditLog.export`), a separate row cap, and its own audit
 * row — the export audits ITSELF, and a spike in exports raises a security signal. None of that is
 * true of paging through the list, which is why the screen keeps the two controls distinct.
 */
export const downloadAuditExport = (filters: AuditScreenFilters): Promise<void> =>
  downloadBlob(
    `/platform/audit-logs/export${toSearch({
      entityType: filters.entityType,
      entityId: filters.entityId,
      actorUserId: filters.actorUserId,
      action: filters.action,
      moduleId: filters.moduleId,
      from: filters.from,
      to: filters.to,
    })}`,
    `audit-${new Date().toISOString().slice(0, 10)}.csv`,
  );

const listActivityLogs = (filters: ActivityScreenFilters): Promise<Paginated<ActivityLogDto>> =>
  getPage<ActivityLogDto>(
    `/platform/activity-logs${toSearch({
      page: filters.page,
      pageSize: filters.pageSize,
      entityType: filters.entityType,
      entityId: filters.entityId,
    })}`,
  );

export const useActivityLogs = (filters: ActivityScreenFilters) =>
  useQuery({
    queryKey: [...ACTIVITY_KEY, 'list', filters],
    queryFn: () => listActivityLogs(filters),
    staleTime: 15_000,
  });
