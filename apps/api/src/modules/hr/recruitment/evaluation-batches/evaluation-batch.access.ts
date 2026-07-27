// RW7 authorization for batches. A batch belongs to a phase, and the phase names the permission
// resource gating it — so the check cannot live in a static `authorize()` on the route: the phase
// is only known once the request's batch (or its `phaseId`) is resolved.
//
// Back-compat rule, identical to the per-phase evaluation check: the generic `evaluation.*` grants
// are a SUPERSET, so a role holding `evaluation.manage` works for every phase with no migration.
import { ForbiddenError, NotFoundError } from '../../../../shared/errors';
import {
  hasPermission,
  scopeOf,
  scopeSelector,
  widerScope,
  type AuthContext,
  type ScopeSelector,
} from '../../../../shared/types';
import { evaluationPhaseService } from '../evaluations';
import { evaluationBatchRepository } from './evaluation-batch.repository';

/** Every permission that can grant sight of a batch phase (RW7 + the generic superset). */
const VIEW_PERMISSIONS = [
  'evaluation.view',
  'securityCheck.view',
  'drivingTest.view',
  'medicalCheck.view',
] as const;

const canView = (ctx: AuthContext, resource: string): boolean =>
  hasPermission(ctx, 'evaluation.view') || hasPermission(ctx, `${resource}.view`);

const canManage = (ctx: AuthContext, resource: string): boolean =>
  hasPermission(ctx, 'evaluation.manage') || hasPermission(ctx, `${resource}.manageBatch`);

/** The scope selector to read a phase's batches with — the caller's own grant, whichever it is. */
export const phaseViewScope = (ctx: AuthContext, resource: string): ScopeSelector =>
  scopeSelector(ctx, hasPermission(ctx, `${resource}.view`) ? `${resource}.view` : 'evaluation.view');

export const phaseManageScope = (ctx: AuthContext, resource: string): ScopeSelector =>
  scopeSelector(
    ctx,
    hasPermission(ctx, `${resource}.manageBatch`) ? `${resource}.manageBatch` : 'evaluation.manage',
  );

/**
 * The list endpoint spans every batch phase at once, so it runs at the WIDEST scope the caller
 * holds — narrowing per phase would need a query per phase (the same rule the stage counters use).
 */
export const anyPhaseViewScope = (ctx: AuthContext): ScopeSelector => {
  const widest = VIEW_PERMISSIONS.reduce<ReturnType<typeof scopeOf>>((acc, key) => {
    const granted = scopeOf(ctx, key);
    if (granted === undefined) return acc;
    return acc === undefined ? granted : widerScope(acc, granted);
  }, undefined);
  return { ...scopeSelector(ctx, 'evaluation.view'), scope: widest ?? 'own' };
};

export const canViewAnyPhase = (ctx: AuthContext): boolean =>
  VIEW_PERMISSIONS.some((key) => hasPermission(ctx, key));

/** Catalogs are paged; evaluation phases are a handful, never hundreds. */
const CATALOG_PAGE_SIZE = 100;

/**
 * The phases whose batches this caller may see. An unfiltered list is restricted to exactly these
 * — otherwise a company doctor listing batches would be handed the security ones, since the
 * collection is one aggregate across every phase. Deactivated phases are included: their batches
 * are history, and history stays visible to whoever could see the phase.
 */
export const visibleBatchPhaseIds = async (ctx: AuthContext): Promise<string[]> => {
  const phases = await evaluationPhaseService.list({
    page: 1,
    pageSize: CATALOG_PAGE_SIZE,
    sortDir: 'asc',
  });
  return phases.items
    .filter((phase) => canView(ctx, phase.permissionResource))
    .map((phase) => String(phase._id));
};

/** Resolve a phase's permission resource, asserting the caller may VIEW it. */
export const assertPhaseView = async (ctx: AuthContext, phaseId: string): Promise<string> => {
  const phase = await evaluationPhaseService.getById(phaseId);
  if (!canView(ctx, phase.permissionResource)) throw new ForbiddenError();
  return phase.permissionResource;
};

/** Resolve a phase's permission resource, asserting the caller may MANAGE its batches. */
export const assertPhaseManage = async (ctx: AuthContext, phaseId: string): Promise<string> => {
  const phase = await evaluationPhaseService.getById(phaseId);
  if (!canManage(ctx, phase.permissionResource)) throw new ForbiddenError();
  return phase.permissionResource;
};

/**
 * Which permission applies to a request addressing an EXISTING batch. The phase is a property of
 * the record, so it is resolved with an unscoped read that returns nothing to the caller — the
 * scoped read that follows in the service is what decides whether the batch is theirs to see.
 */
const phaseIdOf = async (id: string): Promise<string> => {
  const doc = await evaluationBatchRepository.findByIdSystem(id);
  if (doc === null) throw new NotFoundError();
  return String(doc.phaseId);
};

export const batchViewScope = async (ctx: AuthContext, id: string): Promise<ScopeSelector> =>
  phaseViewScope(ctx, await assertPhaseView(ctx, await phaseIdOf(id)));

export const batchManageScope = async (ctx: AuthContext, id: string): Promise<ScopeSelector> =>
  phaseManageScope(ctx, await assertPhaseManage(ctx, await phaseIdOf(id)));
