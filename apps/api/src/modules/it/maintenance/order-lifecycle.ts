// The maintenance-order state machine (design §6) — a pure table, like the ticket one.
//
// Kept free of a database, a request and a clock so the rules that decide whether an asset can be
// touched are checkable in milliseconds, and a future edit that quietly opens a path fails here.
import { type ItMaintenanceOrderStatus } from '@ecms/contracts';

/**
 * ```
 * open ──start──▶ inProgress ──complete──▶ completed
 *   │                  │
 *   └──────cancel──────┴──cancel──▶ cancelled
 * ```
 */
export const MAINTENANCE_ORDER_TRANSITIONS: Readonly<
  Record<ItMaintenanceOrderStatus, readonly ItMaintenanceOrderStatus[]>
> = {
  open: ['inProgress', 'cancelled'],
  inProgress: ['completed', 'cancelled'],
  // Both terminal: a completed order is the maintenance record, and re-opening it would make the
  // asset's history say something that did not happen. A new order is the honest path.
  completed: [],
  cancelled: [],
};

export const canTransitionOrder = (
  from: ItMaintenanceOrderStatus,
  to: ItMaintenanceOrderStatus,
): boolean => MAINTENANCE_ORDER_TRANSITIONS[from].includes(to);

/** Statuses where the order still governs its asset — what blocks a custody move (§2.7). */
export const ACTIVE_ORDER_STATUSES: readonly ItMaintenanceOrderStatus[] = ['open', 'inProgress'];

export const isActiveOrderStatus = (status: ItMaintenanceOrderStatus): boolean =>
  ACTIVE_ORDER_STATUSES.includes(status);
