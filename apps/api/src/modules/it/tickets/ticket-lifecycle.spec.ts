// The state machine, tested as the pure table it is — no database, no request, no clock.
//
// This is the whole reason `TICKET_TRANSITIONS` is a table rather than a pile of `if`s in the
// service: the rules that decide whether a help desk can be audited are checkable in milliseconds,
// and a future edit that quietly opens a path (un-cancelling a ticket, reopening a cancelled one)
// fails here rather than in a report six months later.
import { describe, expect, it } from 'vitest';
import { IT_TICKET_STATUSES, type ItTicketStatus } from '@ecms/contracts';
import {
  ACTIVE_TICKET_STATUSES,
  TICKET_TRANSITIONS,
  canTransition,
  isActiveTicketStatus,
} from './ticket-lifecycle';

describe('the ticket state machine', () => {
  it('covers every status the contract declares — no status without a rule', () => {
    expect(Object.keys(TICKET_TRANSITIONS).sort()).toEqual([...IT_TICKET_STATUSES].sort());
  });

  it('names only real statuses as targets', () => {
    for (const targets of Object.values(TICKET_TRANSITIONS)) {
      for (const target of targets) {
        expect(IT_TICKET_STATUSES).toContain(target);
      }
    }
  });

  it('never lets a status transition to itself', () => {
    for (const status of IT_TICKET_STATUSES) {
      expect(canTransition(status, status), `${status} → ${status}`).toBe(false);
    }
  });

  it('walks the happy path: open → inProgress → resolved → closed', () => {
    expect(canTransition('open', 'inProgress')).toBe(true);
    expect(canTransition('inProgress', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'closed')).toBe(true);
  });

  it('pauses and resumes: inProgress ⇄ onHold', () => {
    expect(canTransition('inProgress', 'onHold')).toBe(true);
    expect(canTransition('onHold', 'inProgress')).toBe(true);
  });

  // Both directions of reopen, because a fix that did not hold is discovered at either point.
  it('reopens from resolved and from closed, and only into inProgress', () => {
    expect(canTransition('resolved', 'inProgress')).toBe(true);
    expect(canTransition('closed', 'inProgress')).toBe(true);
    expect(TICKET_TRANSITIONS.closed).toEqual(['inProgress']);
  });

  // Cancelled means "this was never a real ticket". Un-cancelling would make the record say
  // something that did not happen, so the only honest path forward is a new ticket.
  it('makes cancelled terminal', () => {
    expect(TICKET_TRANSITIONS.cancelled).toEqual([]);
    for (const status of IT_TICKET_STATUSES) {
      expect(canTransition('cancelled', status), `cancelled → ${status}`).toBe(false);
    }
  });

  it('cancels only live work — never a resolved or closed ticket', () => {
    for (const status of ['open', 'inProgress', 'onHold'] as ItTicketStatus[]) {
      expect(canTransition(status, 'cancelled'), `${status} → cancelled`).toBe(true);
    }
    for (const status of ['resolved', 'closed'] as ItTicketStatus[]) {
      expect(canTransition(status, 'cancelled'), `${status} → cancelled`).toBe(false);
    }
  });

  it('never resolves a ticket that is not being worked on', () => {
    for (const status of ['open', 'onHold', 'closed', 'cancelled'] as ItTicketStatus[]) {
      expect(canTransition(status, 'resolved'), `${status} → resolved`).toBe(false);
    }
  });

  it('never returns a ticket to open — the queue is entered once', () => {
    for (const status of IT_TICKET_STATUSES) {
      expect(canTransition(status, 'open'), `${status} → open`).toBe(false);
    }
  });

  it('closes only from resolved — a ticket is not closed without an answer', () => {
    for (const status of IT_TICKET_STATUSES) {
      expect(canTransition(status, 'closed'), `${status} → closed`).toBe(status === 'resolved');
    }
  });

  // The three statuses whose SLA clocks still mean something (§6). Every terminal outcome is
  // excluded, which is what makes "active" a usable filter for the queue and the dashboards.
  it('counts exactly the live statuses as active', () => {
    expect([...ACTIVE_TICKET_STATUSES].sort()).toEqual(['inProgress', 'onHold', 'open']);
    for (const status of IT_TICKET_STATUSES) {
      const live = status === 'open' || status === 'inProgress' || status === 'onHold';
      expect(isActiveTicketStatus(status), status).toBe(live);
    }
  });

  it('lets every live status reach a terminal one, so nothing can get stuck', () => {
    const terminal = new Set<ItTicketStatus>(['closed', 'cancelled']);
    for (const start of ACTIVE_TICKET_STATUSES) {
      const seen = new Set<ItTicketStatus>();
      const queue: ItTicketStatus[] = [start];
      while (queue.length > 0) {
        const current = queue.shift() as ItTicketStatus;
        if (seen.has(current)) continue;
        seen.add(current);
        queue.push(...TICKET_TRANSITIONS[current]);
      }
      expect([...seen].some((s) => terminal.has(s)), `${start} cannot reach a terminal status`).toBe(
        true,
      );
    }
  });
});
