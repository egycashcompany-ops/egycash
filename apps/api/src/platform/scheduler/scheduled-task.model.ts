// Scheduled-task registry (Review R3): one collection answers "what runs when";
// BullMQ repeatable jobs remain the executor.
import { Schema, model, type Types } from 'mongoose';

export interface ScheduledTaskDoc {
  _id: Types.ObjectId;
  key: string;
  description: string;
  cron: string;
  ownerService: string;
  status: 'active' | 'paused';
  lastRunAt: Date | null;
  lastResult: 'ok' | 'failed' | null;
  createdAt: Date;
  updatedAt: Date;
}

const scheduledTaskSchema = new Schema<ScheduledTaskDoc>(
  {
    key: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    cron: { type: String, required: true },
    ownerService: { type: String, required: true },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    lastRunAt: { type: Date, default: null },
    lastResult: { type: String, enum: ['ok', 'failed', null], default: null },
  },
  { strict: true, timestamps: true, versionKey: false },
);

export const ScheduledTaskModel = model<ScheduledTaskDoc>(
  'ScheduledTask',
  scheduledTaskSchema,
  'scheduled_tasks',
);
