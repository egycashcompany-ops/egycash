// The operating day. `ensureForDate` is the quiet path crew planning rides — the day is an
// anchor, not a ceremony: legacy has no day entity at all, so requiring an explicit create
// before planning would invent a step the workflow never had. Explicit create/open/close exist
// for the surfaces that will need them (execution and reports slices gate on OPEN/CLOSED;
// nothing in OP-3 does, matching legacy's lockless planning).
import { ConflictError } from '../../../shared/errors';
import { BusinessRuleError } from '../../../shared/errors';
import { OperationsEvents, type OperationsDayStatus } from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { canTransitionDay } from './day-status';
import { operationsDayRepository } from './day.repository';
import { type OperationsDayDoc } from './day.model';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'day',
  entityId: id,
});

const snapshot = (doc: OperationsDayDoc) => ({
  date: doc.date.toISOString(),
  status: doc.status,
});

/** Q15 NORMALIZE — a day's identity is the UTC day. */
export const utcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

class OperationsDayService {
  async findByDate(date: Date): Promise<OperationsDayDoc | null> {
    return operationsDayRepository.findByDate(utcDay(date));
  }

  async create(date: Date, by: string): Promise<OperationsDayDoc> {
    const doc = await operationsDayRepository.create(
      { date: utcDay(date), status: 'planning' },
      { by },
    ); // duplicate date → ConflictError via ux_date
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(OperationsEvents.DayCreated, {
      dayId: String(doc._id),
      date: doc.date,
      status: doc.status,
    });
    return doc;
  }

  /** Get-or-create, race-safe: a concurrent create loses on ux_date and re-reads. */
  async ensureForDate(date: Date, by: string): Promise<OperationsDayDoc> {
    const day = utcDay(date);
    const existing = await operationsDayRepository.findByDate(day);
    if (existing !== null) return existing;
    try {
      return await this.create(day, by);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      const raced = await operationsDayRepository.findByDate(day);
      if (raced === null) throw error;
      return raced;
    }
  }

  async transition(
    id: string,
    to: Extract<OperationsDayStatus, 'open' | 'closed'>,
    version: number,
    by: string,
  ): Promise<OperationsDayDoc> {
    const before = await operationsDayRepository.getById(id);
    if (!canTransitionDay(before.status, to)) {
      throw new BusinessRuleError(
        `an operating day cannot go from '${before.status}' to '${to}'`,
        'OPERATIONS_INVALID_DAY_TRANSITION',
      );
    }
    const stamp =
      to === 'open'
        ? { openedById: new Types.ObjectId(by), openedAt: new Date() }
        : { closedById: new Types.ObjectId(by), closedAt: new Date() };
    const updated = await operationsDayRepository.updateById(
      id,
      { status: to, ...stamp },
      { by, version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(to === 'open' ? OperationsEvents.DayOpened : OperationsEvents.DayClosed, {
      dayId: id,
      date: updated.date,
      status: updated.status,
    });
    return updated;
  }
}

export const operationsDayService = new OperationsDayService();
