// Operations / Cash Transfer — the domain vocabulary (OP-1, Domain Foundation).
//
// This file is the normalized form of the legacy status system reverse-engineered in
// docs/12-planning/operations-legacy-discovery.md. The legacy `transactions.status` ladder is
// NUMERIC and NON-ORDINAL — the literal value 1 is the TERMINAL "completed" state for both
// shipment types, not the first step (discovery §6, contad_app.js:564/1220/1737). That fact is
// pinned here as data, in one place, so every later slice (queries, migration, report parity)
// reads the same mapping instead of re-deriving it.
//
// Vocabulary only, by design: DTOs, input schemas and event payloads arrive WITH the slice that
// serves them (the IT precedent — "a grant is declared with its operation, never ahead of it"),
// and transition GUARDS are service logic (the fleet `vehicle-status.ts` precedent), not contract
// data. What lives here is what every slice must agree on before any of them exists.
import { z } from 'zod';

// ── Shipment type ───────────────────────────────────────────────────────────────────────────────

/** `daily` = legacy "يومي" (same-day pickup run) · `secured` = legacy "محصنة" (vaulted shipment). */
export const OPERATIONS_SHIPMENT_TYPES = ['daily', 'secured'] as const;
export const OperationsShipmentTypeSchema = z.enum(OPERATIONS_SHIPMENT_TYPES);
export type OperationsShipmentType = z.infer<typeof OperationsShipmentTypeSchema>;

/**
 * The exact Arabic strings the legacy system stores in `transactions.type` (discovery §5.1,
 * contad_app.js:263-264). Migration and parity reports match on these verbatim.
 */
export const LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS: Record<OperationsShipmentType, string> = {
  daily: 'يومي',
  secured: 'محصنة',
};

// ── Shipment status ─────────────────────────────────────────────────────────────────────────────

/**
 * The normalized shipment lifecycle (discovery §6, quirk Q1: PRESERVE the meaning, NORMALIZE the
 * encoding). Daily shipments use only `draft` → `completed`; secured shipments walk
 * `draft` → `inVault` → `dispatched` → `completed`. `completed` is terminal for both.
 */
export const OPERATIONS_SHIPMENT_STATUSES = [
  'draft',
  'inVault',
  'dispatched',
  'completed',
] as const;
export const OperationsShipmentStatusSchema = z.enum(OPERATIONS_SHIPMENT_STATUSES);
export type OperationsShipmentStatus = z.infer<typeof OperationsShipmentStatusSchema>;

/**
 * Legacy numeric `transactions.status` → normalized status. NON-ORDINAL by observation:
 *
 *   0 = created, not yet received        → draft       (contad_app.js:316,406,744,831)
 *   2 = received into the vault          → inVault     (contad_app.js:1220,1275)
 *   3 = dispatched out for delivery      → dispatched  (contad_app.js:1737)
 *   1 = delivered/completed — TERMINAL   → completed   (contad_app.js:564)
 *
 * Every legacy report filters on status 1 + deleted 0 (discovery §12) — that is what makes 1 the
 * terminal state, and what this map exists to never let anyone forget.
 */
export const LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE: Record<number, OperationsShipmentStatus> = {
  0: 'draft',
  2: 'inVault',
  3: 'dispatched',
  1: 'completed',
};

/** Inverse of `LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE`, for parity checks against legacy data. */
export const LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS: Record<OperationsShipmentStatus, number> = {
  draft: 0,
  inVault: 2,
  dispatched: 3,
  completed: 1,
};

// ── Shipment leg ────────────────────────────────────────────────────────────────────────────────

/**
 * A shipment's two crew legs, replacing the legacy leader1/leader2 field duplication (discovery
 * §4.1): `pickup` = leg 1 (leader1/car_num1, attributed by rec_date), `delivery` = leg 2
 * (leader2/car_num2, secured shipments only, attributed by del_date — ops_report groups the daily
 * facet by leader1 and the secured facet by leader2, contad_app.js:4894/4931).
 */
export const OPERATIONS_SHIPMENT_LEGS = ['pickup', 'delivery'] as const;
export const OperationsShipmentLegSchema = z.enum(OPERATIONS_SHIPMENT_LEGS);
export type OperationsShipmentLeg = z.infer<typeof OperationsShipmentLegSchema>;

// ── Captain execution status (NEW — no legacy counterpart) ──────────────────────────────────────

/**
 * The captain mobile sequential-execution lifecycle (design §17 — NEW, marked as such; the legacy
 * system has no captain execution at all). Sequencing rules (shipment N+1 cannot start before N
 * completes) are service-enforced domain invariants, not schema facts, and arrive with OP-8.
 */
export const OPERATIONS_EXECUTION_STATUSES = [
  'pending',
  'active',
  'pickedUp',
  'delivered',
  'completed',
  'cancelled',
] as const;
export const OperationsExecutionStatusSchema = z.enum(OPERATIONS_EXECUTION_STATUSES);
export type OperationsExecutionStatus = z.infer<typeof OperationsExecutionStatusSchema>;

// ── Operations day (NEW — no legacy counterpart) ────────────────────────────────────────────────

/**
 * The explicit operating-day lifecycle (design §16 — NEW). Legacy has no day entity: "today" is
 * derived per-query by exact-equality date match (discovery §5.1, quirk Q15 NORMALIZE). The day
 * entity and its transitions arrive with OP-3.
 */
export const OPERATIONS_DAY_STATUSES = ['planning', 'open', 'closed'] as const;
export const OperationsDayStatusSchema = z.enum(OPERATIONS_DAY_STATUSES);
export type OperationsDayStatus = z.infer<typeof OperationsDayStatusSchema>;
