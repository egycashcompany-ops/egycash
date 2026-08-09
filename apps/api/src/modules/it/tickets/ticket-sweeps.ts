// The two help-desk sweeps (design §4.5, §4.4, §4.8).
//
// **Idempotency without a second collection.** Fleet needed a `sweep_marks` collection because the
// thing it announced had no field of its own. Here the mark IS the record: `sla.responseBreachedAt`
// is both the breach stamp and the "already handled" flag, so the sweep is safe to run twice, to
// overlap with itself, or to replay after a crash — the query only ever returns rows with no stamp,
// and a conditional update makes the write itself a no-op the second time (FR-6).
//
// Both sweeps run under the SYSTEM actor: no human is behind them, which is exactly why the audit
// row matters (the contract-generation precedent).
import { Types } from 'mongoose';
import { ItEvents, ItSettingKeys, type ItSlaPhase } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { settingsService } from '../../../platform/settings';
import { itTicketRepository } from './ticket.repository';
import { itTicketEventRepository } from './ticket-event.repository';
import { ItTicketModel } from './ticket.model';
import { type ItTicketDoc } from './ticket.model';

/** A bound per run: a sweep is a heartbeat, not a migration. Anything left is taken next tick. */
const BATCH = 500;

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'ticket', entityId: id });

/**
 * Stamp one phase's breach, once.
 *
 * The update is CONDITIONAL on the stamp still being null, so two overlapping sweeps cannot both
 * write it — the second matches nothing and reports zero, which is the correct outcome rather than
 * a duplicated event.
 */
const stampBreach = async (ticket: ItTicketDoc, phase: ItSlaPhase, at: Date): Promise<boolean> => {
  const stampField = phase === 'response' ? 'sla.responseBreachedAt' : 'sla.resolutionBreachedAt';
  const dueAt = phase === 'response' ? ticket.sla.responseDueAt : ticket.sla.resolutionDueAt;

  const result = await ItTicketModel.updateOne(
    { _id: ticket._id, [stampField]: null, isDeleted: false },
    { $set: { [stampField]: at } },
  ).exec();
  if (result.modifiedCount === 0) return false;

  await itTicketEventRepository.append(
    {
      subjectId: new Types.ObjectId(String(ticket._id)),
      type: 'slaBreached',
      at,
      actorUserId: null,
      actorName: '',
      metadata: { phase, dueAt: dueAt.toISOString() },
    } as never,
    // `null`, not a 'system' sentinel: `BaseRepository.create` casts `by` to an ObjectId, so any
    // non-id string throws. Null IS how the platform records "no human actor" — every other
    // module's system write does the same, and `actorUserId: null` on the row says it again.
    { by: null },
  );
  await auditService.record({
    entityRef: entityRef(String(ticket._id)),
    action: 'slaBreached',
    changes: [{ field: phase, old: null, new: dueAt.toISOString() }],
  });
  await emit(ItEvents.TicketSlaBreached, {
    ticketId: String(ticket._id),
    ticketCode: ticket.ticketCode,
    phase,
    dueAt: dueAt.toISOString(),
  });
  return true;
};

/** §4.5 — every five minutes: stamp the clocks that have run out, exactly once each. */
export const slaBreachSweep = async (now = new Date()): Promise<{ stamped: number }> => {
  let stamped = 0;
  for (const phase of ['response', 'resolution'] as const) {
    const overdue = await itTicketRepository.findUnstampedOverdue(phase, now, BATCH);
    for (const ticket of overdue) {
      if (await stampBreach(ticket, phase, now)) stamped += 1;
    }
  }
  if (stamped > 0) logger.info({ stamped }, 'it: SLA breaches stamped');
  return { stamped };
};

/**
 * §4.4 — daily: close tickets that have sat `resolved` past the window.
 *
 * `0` disables it, which is the honest way to express "we do not auto-close" rather than a magic
 * large number. The close is conditional on the ticket still being `resolved`, so a human closing
 * or reopening it first simply wins.
 */
export const ticketAutoCloseSweep = async (now = new Date()): Promise<{ closed: number }> => {
  // Organization scope — a sweep acts for the whole company, not for a user or a branch.
  const days = await settingsService.resolve<number>(ItSettingKeys.TicketAutoCloseDays, {
    userId: null,
    branchId: null,
  });
  if (typeof days !== 'number' || days <= 0) return { closed: 0 };

  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const stale = await itTicketRepository.findResolvedBefore(cutoff, BATCH);
  let closed = 0;
  for (const ticket of stale) {
    const result = await ItTicketModel.updateOne(
      { _id: ticket._id, status: 'resolved', isDeleted: false },
      { $set: { status: 'closed', closedAt: now } },
    ).exec();
    if (result.modifiedCount === 0) continue;
    closed += 1;

    await itTicketEventRepository.append(
      {
        subjectId: new Types.ObjectId(String(ticket._id)),
        type: 'statusChanged',
        at: now,
        actorUserId: null,
        actorName: '',
        fromStatus: 'resolved',
        toStatus: 'closed',
        metadata: { autoClosed: true, afterDays: days },
      } as never,
      { by: 'system' },
    );
    await auditService.record({
      entityRef: entityRef(String(ticket._id)),
      action: 'statusChange',
      changes: [{ field: 'status', old: 'resolved', new: 'closed' }],
    });
    await emit(ItEvents.TicketStatusChanged, {
      ticketId: String(ticket._id),
      ticketCode: ticket.ticketCode,
      from: 'resolved',
      to: 'closed',
      summary: null,
    });
  }
  if (closed > 0) logger.info({ closed }, 'it: tickets auto-closed');
  return { closed };
};
