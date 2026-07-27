// Pure id helpers for the recruitment timeline (I9). No I/O, no clock beyond what is passed in —
// unit-tested directly.
import { randomBytes } from 'node:crypto';

/**
 * A timeline entry's immutable public identity. Time-sortable so a lexicographic sort matches
 * chronological order (48-bit ms timestamp + 80 bits of randomness, Crockford-ish lowercase hex),
 * and unique enough that concurrent writers never collide. Assigned once, never regenerated —
 * the repair task re-derives `sourceKey`, never `eventId`.
 */
export const newEventId = (at: Date = new Date()): string => {
  const ts = at.getTime().toString(16).padStart(12, '0');
  return `evt_${ts}${randomBytes(10).toString('hex')}`;
};

/**
 * The deterministic idempotency key (I5). Derived ONLY from facts that identify the happening —
 * never from the clock or a random value — so the reconciliation task rebuilding an entry from
 * the aggregates produces the same key the original write used, and the unique index makes the
 * rebuild a no-op instead of a duplicate.
 *
 * `discriminator` separates several entries of the same type on the same entity: the attempt
 * number for stage records, the changed dimension for a placement change, the decision index for
 * a re-decided evaluation.
 */
export const timelineSourceKey = (parts: {
  applicantId: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  discriminator?: string | number | null;
}): string =>
  [
    parts.applicantId,
    parts.type,
    parts.entityType ?? '-',
    parts.entityId ?? '-',
    parts.discriminator === undefined || parts.discriminator === null ? '-' : String(parts.discriminator),
  ].join(':');

/**
 * The episode id (I9). Entries about the same subject — an interview round, a batch, an offer —
 * share the subject's own id, so grouping by it renders one card per episode. A placement change
 * has no aggregate of its own, so it gets a generated id shared by the entries of that one change.
 */
export const newCorrelationId = (at: Date = new Date()): string =>
  `cor_${at.getTime().toString(16).padStart(12, '0')}${randomBytes(6).toString('hex')}`;
