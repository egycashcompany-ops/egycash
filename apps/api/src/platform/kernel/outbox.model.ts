// Outbox for the reliable event tier (ADR-008): events with business consequences
// are written here inside the emitting service's transaction, then relayed to BullMQ.
import { Schema, model, type Types } from 'mongoose';

export interface OutboxDoc {
  _id: Types.ObjectId;
  eventId: string;
  eventName: string;
  schemaVersion: number;
  payload: unknown;
  actorId: string | null;
  requestId: string | null;
  occurredAt: Date;
  status: 'pending' | 'dispatched' | 'failed';
  attempts: number;
}

const outboxSchema = new Schema<OutboxDoc>(
  {
    eventId: { type: String, required: true, unique: true },
    eventName: { type: String, required: true },
    schemaVersion: { type: Number, required: true },
    payload: { type: Schema.Types.Mixed },
    actorId: { type: String, default: null },
    requestId: { type: String, default: null },
    occurredAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'dispatched', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
  },
  { strict: true },
);
outboxSchema.index({ status: 1, occurredAt: 1 }, { name: 'ix_status_occurredAt' });

export const OutboxModel = model<OutboxDoc>('Outbox', outboxSchema, 'outbox');

export interface ProcessedEventDoc {
  _id: string; // `${eventId}:${handlerId}`
  at: Date;
}

const processedEventSchema = new Schema<ProcessedEventDoc>(
  {
    _id: { type: String },
    at: { type: Date, required: true, expires: 60 * 60 * 24 * 30 },
  },
  { strict: true },
);

export const ProcessedEventModel = model<ProcessedEventDoc>(
  'ProcessedEvent',
  processedEventSchema,
  'processed_events',
);
