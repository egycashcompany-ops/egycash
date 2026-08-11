// The URL is the filter state — read and written as pure functions.
//
// Every list in this module keeps its filters in the query string so a screen full of them can be
// sent to somebody else. Here that matters more than usual: an audit view IS the evidence, and a
// finding that cannot be linked to is a finding that has to be rediscovered by whoever is asked to
// confirm it.
//
// Pure on purpose. This suite has no DOM, so the round trip URL → filters → request → URL is the
// part worth proving, and it can only be proven if it does not live inside a component.
import { AUDIT_ACTIONS, type AuditAction } from '@ecms/contracts';

export const AUDIT_PAGE_SIZE = 25;

/**
 * The screen's own filter shape — dates as `yyyy-mm-dd` strings, which is what the URL and the date
 * input both speak. `ListAuditLogsQuery` types them as `Date` because the server coerces them on
 * arrival; converting here would mean parsing a date only to serialise it again.
 */
export interface AuditScreenFilters {
  page: number;
  pageSize: number;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: AuditAction;
  moduleId?: string;
  from?: string;
  to?: string;
}

const trimmed = (params: URLSearchParams, name: string): string | undefined => {
  const raw = params.get(name)?.trim();
  return raw === undefined || raw === '' ? undefined : raw;
};

/** `page` is 1 unless the URL says otherwise and means it — `?page=0` and `?page=x` are not pages. */
export const pageFrom = (params: URLSearchParams): number => {
  const raw = Number(params.get('page') ?? '1');
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
};

/**
 * An `action` the contract does not declare is DROPPED rather than forwarded.
 *
 * The endpoint validates against the same enum and would answer 400, which on a screen reads as
 * "the audit log is broken" rather than "that link has a typo in it". The filter simply does not
 * apply, and the unrecognised value is not echoed back into the control either.
 */
export const actionFrom = (params: URLSearchParams): AuditAction | undefined => {
  const raw = trimmed(params, 'action');
  return raw !== undefined && (AUDIT_ACTIONS as readonly string[]).includes(raw)
    ? (raw as AuditAction)
    : undefined;
};

/** A date the browser produced (`yyyy-mm-dd`); anything else is not a date and is dropped. */
const dateFrom = (params: URLSearchParams, name: string): string | undefined => {
  const raw = trimmed(params, name);
  if (raw === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return Number.isNaN(Date.parse(raw)) ? undefined : raw;
};

// Each value is read ONCE and then spread — `exactOptionalPropertyTypes` cannot narrow a second
// call to the same function, and an absent filter must be absent rather than explicitly undefined.
export const readAuditFilters = (params: URLSearchParams): AuditScreenFilters => {
  const entityType = trimmed(params, 'entityType');
  const entityId = trimmed(params, 'entityId');
  const actorUserId = trimmed(params, 'actorUserId');
  const action = actionFrom(params);
  const moduleId = trimmed(params, 'moduleId');
  const from = dateFrom(params, 'from');
  const to = dateFrom(params, 'to');
  return {
    page: pageFrom(params),
    pageSize: AUDIT_PAGE_SIZE,
    ...(entityType === undefined ? {} : { entityType }),
    ...(entityId === undefined ? {} : { entityId }),
    ...(actorUserId === undefined ? {} : { actorUserId }),
    ...(action === undefined ? {} : { action }),
    ...(moduleId === undefined ? {} : { moduleId }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
};

export interface ActivityScreenFilters {
  page: number;
  pageSize: number;
  entityType?: string;
  entityId?: string;
}

export const readActivityFilters = (params: URLSearchParams): ActivityScreenFilters => {
  const entityType = trimmed(params, 'entityType');
  const entityId = trimmed(params, 'entityId');
  return {
    page: pageFrom(params),
    pageSize: AUDIT_PAGE_SIZE,
    ...(entityType === undefined ? {} : { entityType }),
    ...(entityId === undefined ? {} : { entityId }),
  };
};

/**
 * Write one parameter back, and reset the page unless the page is what changed.
 *
 * Narrowing a filter while staying on page 7 shows an empty screen that looks like "no results"
 * when the results are on page 1 — the commonest way a filtered list lies to its reader.
 */
export const withParam = (
  params: URLSearchParams,
  name: string,
  value: string,
): URLSearchParams => {
  const next = new URLSearchParams(params);
  if (value.trim() === '') next.delete(name);
  else next.set(name, value);
  if (name !== 'page') next.delete('page');
  return next;
};

/** True when anything beyond paging is applied — the export sends exactly these. */
export const hasActiveFilters = (filters: AuditScreenFilters): boolean =>
  [filters.entityType, filters.entityId, filters.actorUserId, filters.action, filters.moduleId, filters.from, filters.to].some(
    (value) => value !== undefined,
  );
