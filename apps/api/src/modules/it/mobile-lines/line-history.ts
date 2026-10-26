// The few things every write on a line does the same way: name the audited entity, record the
// history entry, build the indexes first.
import { Types, type ClientSession } from 'mongoose';
import { type ItMobileLineEventType } from '@ecms/contracts';
import { type AuthContext } from '../../../shared/types';
import { itMobileLineRepository } from './mobile-line.repository';
import { itMobileLineAssignmentRepository } from './line-assignment.repository';
import { itMobileLineEventRepository } from './line-event.repository';
import { itMobileLineReceiptRepository } from './line-receipt.repository';

/** The audited entity — a LITERAL pair, so the realtime registry's scan can classify it. */
export const lineEntityRef = (id: string) => ({
  moduleId: 'it',
  entityType: 'mobileLine',
  entityId: id,
});

/** An audit row's change: the transition, not a diff of the whole line. */
export const change = (field: string, from: unknown, to: unknown) => ({
  field,
  old: from,
  new: to,
});

const actorNameOf = (ctx: AuthContext): string =>
  ctx.identity?.displayName?.[ctx.locale === 'ar' ? 'ar' : 'en'] ?? '';

export interface LineHistoryInput {
  lineId: string;
  type: ItMobileLineEventType;
  at: Date;
  metadata: Record<string, unknown>;
  notes: string | null;
}

/** One history entry, inside the transaction that writes the fact it records. */
export const writeLineHistory = async (
  input: LineHistoryInput,
  ctx: AuthContext,
  session: ClientSession,
): Promise<void> => {
  await itMobileLineEventRepository.append(
    {
      subjectId: new Types.ObjectId(input.lineId),
      type: input.type,
      at: input.at,
      actorUserId: new Types.ObjectId(ctx.userId),
      actorName: actorNameOf(ctx),
      metadata: input.metadata,
      notes: input.notes,
    },
    { by: ctx.userId, session },
  );
};

/**
 * Every collection the register writes, with its indexes, before the first write of any path —
 * and for the go-live import, before its one transaction. See `ensure-collection.ts` for why.
 */
export const ensureItMobileLineCollections = async (): Promise<void> => {
  await Promise.all([
    itMobileLineRepository.ensureCollection(),
    itMobileLineAssignmentRepository.ensureCollection(),
    itMobileLineEventRepository.ensureCollection(),
    itMobileLineReceiptRepository.ensureCollection(),
  ]);
};
