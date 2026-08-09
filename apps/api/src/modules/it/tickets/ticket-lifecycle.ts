// The ticket state machine (design §4.4) — code, not the ADR-011 platform engine.
//
// That engine is an accepted ADR that was never built as a platform service. Recruitment wrote its
// own; Fleet used code-defined lifecycles in services. Tickets follow Fleet: the help desk must not
// be the hostage that forces building a platform engine first. The migration note for the day that
// engine exists is the proposed ADR-022.
//
// Kept as a PURE table so the transitions are testable without a database, a request or a clock —
// the service consults it, and every guard that needs more than the current status (a resolution
// summary, a reopen window) stays in the service where that context lives.
import { type ItTicketStatus } from '@ecms/contracts';

/**
 * ```
 * open ──assign/start──▶ inProgress ──▶ resolved ──close──▶ closed
 *   │        ▲   │ hold ▲    │                        ▲ reopen │
 *   │        │   ▼      │    ▼                        └────────┘ (reopen → inProgress)
 *   │        │  onHold ─┘  cancelled
 *   └─cancel─┘
 * ```
 */
export const TICKET_TRANSITIONS: Readonly<Record<ItTicketStatus, readonly ItTicketStatus[]>> = {
  open: ['inProgress', 'cancelled'],
  inProgress: ['onHold', 'resolved', 'cancelled'],
  onHold: ['inProgress', 'cancelled'],
  // A resolved ticket can be closed, or reopened when the fix did not hold.
  resolved: ['closed', 'inProgress'],
  // Closed is not the end of the world — reopening within the window returns it to work.
  closed: ['inProgress'],
  // Cancelled IS terminal: it means "this was never a real ticket", and un-cancelling would make
  // the record say something that did not happen. A new ticket is the honest path.
  cancelled: [],
};

export const canTransition = (from: ItTicketStatus, to: ItTicketStatus): boolean =>
  TICKET_TRANSITIONS[from].includes(to);

/** Statuses where the SLA clocks still mean something and the ticket is live work (§6). */
export const ACTIVE_TICKET_STATUSES: readonly ItTicketStatus[] = ['open', 'inProgress', 'onHold'];

export const isActiveTicketStatus = (status: ItTicketStatus): boolean =>
  ACTIVE_TICKET_STATUSES.includes(status);
