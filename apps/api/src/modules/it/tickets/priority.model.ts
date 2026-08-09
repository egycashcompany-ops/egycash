// `it_ticket_priorities` — the priority IS the SLA policy (design §2.6).
//
// One collection, not two. The v1.0 design split "priority" from "SLA policy" and joined them 1:1;
// that is normalization without a purpose — an admin tunes the name, the rank and the two targets
// as a single decision on a single screen. Splitting them would have cost the module a collection,
// a permission and a join, and bought nothing.
//
// Priorities ARCHIVE, never delete (FR-11): every ticket ever opened points at one.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItTicketPriorityDoc extends BaseDocFields {
  name: LocalizedString;
  rank: number;
  responseMinutes: number;
  resolutionMinutes: number;
  isActive: boolean;
}

const prioritySchema = new Schema<ItTicketPriorityDoc>(
  {
    name: {
      type: new Schema<LocalizedString>(
        { ar: { type: String, required: true }, en: { type: String, required: true } },
        { _id: false },
      ),
      required: true,
    },
    rank: { type: Number, required: true },
    responseMinutes: { type: Number, required: true },
    resolutionMinutes: { type: Number, required: true },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One priority per rank among the live rows — two "rank 10" priorities is an ordering nobody can
// reason about. Partial so archived rows free their rank for a replacement.
prioritySchema.index(
  { rank: 1 },
  { unique: true, name: 'ux_priority_rank', partialFilterExpression: { isDeleted: false, isActive: true } },
);
prioritySchema.index({ isActive: 1, rank: 1 }, { name: 'ix_active_rank' });

export const ItTicketPriorityModel = model<ItTicketPriorityDoc>(
  'ItTicketPriority',
  prioritySchema,
  'it_ticket_priorities',
);
