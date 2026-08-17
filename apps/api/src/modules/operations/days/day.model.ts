// The operating day (design §16.1) — NEW, no legacy counterpart: legacy derives "today" per-query
// by exact-equality date match (discovery §5.1, Q15). This row makes the day an explicit anchor
// for crew planning now and for execution/vault/reports in later slices. Deliberately carries NO
// gating power in OP-3 — legacy planning knows no day lock, and a lock would be an invented rule.
import { Schema, model, type Types } from 'mongoose';
import { OPERATIONS_DAY_STATUSES, type OperationsDayStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsDayDoc extends BaseDocFields {
  /** UTC midnight — the pair rule of fleet duty rows applies: the date IS the identity. */
  date: Date;
  status: OperationsDayStatus;
  openedById: Types.ObjectId | null;
  openedAt: Date | null;
  closedById: Types.ObjectId | null;
  closedAt: Date | null;
}

const daySchema = new Schema<OperationsDayDoc>(
  {
    date: { type: Date, required: true },
    status: { type: String, required: true, enum: OPERATIONS_DAY_STATUSES, default: 'planning' },
    openedById: { type: Schema.Types.ObjectId, default: null },
    openedAt: { type: Date, default: null },
    closedById: { type: Schema.Types.ObjectId, default: null },
    closedAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

daySchema.index(
  { date: 1 },
  { unique: true, name: 'ux_date', partialFilterExpression: { isDeleted: false } },
);

export const OperationsDayModel = model<OperationsDayDoc>(
  'OperationsDay',
  daySchema,
  'operations_days',
);
