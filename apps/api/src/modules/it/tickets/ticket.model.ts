// `it_tickets` (design §2.6). `status` moves only through the named transitions of §4.4, and the
// SLA block is a SNAPSHOT taken at creation — see `sla.policy`.
import { Schema, model, type Types } from 'mongoose';
import { IT_TICKET_STATUSES, type ItTicketStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItTicketSlaSub {
  /**
   * The targets AS THEY WERE when the ticket opened. Copied, never referenced: editing a priority
   * later must not move a running clock or rewrite a closed ticket's history (§2.6, the
   * contract-template-versioning reasoning).
   */
  policy: { responseMinutes: number; resolutionMinutes: number };
  responseDueAt: Date;
  resolutionDueAt: Date;
  firstResponseAt: Date | null;
  /** Set ONCE by the sweep and never cleared — a late resolution does not un-breach (FR-6). */
  responseBreachedAt: Date | null;
  resolutionBreachedAt: Date | null;
  /** Time accumulated in `onHold`. The response clock never pauses; only resolution does. */
  pausedMs: number;
  holdStartedAt: Date | null;
}

export interface ItTicketResolutionSub {
  summary: string;
  resolvedByUserId: Types.ObjectId;
  resolvedAt: Date;
}

export interface ItTicketDoc extends BaseDocFields {
  ticketCode: string;
  title: string;
  description: string;
  requesterUserId: Types.ObjectId;
  /** Stamped from the requester at creation — the scope anchor (design §2.6). */
  branchId: Types.ObjectId | null;
  categoryId: Types.ObjectId;
  priorityId: Types.ObjectId;
  assetId: Types.ObjectId | null;
  assignedTechnicianUserId: Types.ObjectId | null;
  status: ItTicketStatus;
  sla: ItTicketSlaSub;
  resolution: ItTicketResolutionSub | null;
  closedAt: Date | null;
  reopenCount: number;
}

const slaSchema = new Schema<ItTicketSlaSub>(
  {
    policy: {
      type: new Schema(
        {
          responseMinutes: { type: Number, required: true },
          resolutionMinutes: { type: Number, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    responseDueAt: { type: Date, required: true },
    resolutionDueAt: { type: Date, required: true },
    firstResponseAt: { type: Date, default: null },
    responseBreachedAt: { type: Date, default: null },
    resolutionBreachedAt: { type: Date, default: null },
    pausedMs: { type: Number, required: true, default: 0 },
    holdStartedAt: { type: Date, default: null },
  },
  { _id: false },
);

const resolutionSchema = new Schema<ItTicketResolutionSub>(
  {
    summary: { type: String, required: true },
    resolvedByUserId: { type: Schema.Types.ObjectId, required: true },
    resolvedAt: { type: Date, required: true },
  },
  { _id: false },
);

const ticketSchema = new Schema<ItTicketDoc>(
  {
    ticketCode: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    requesterUserId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    priorityId: { type: Schema.Types.ObjectId, required: true },
    assetId: { type: Schema.Types.ObjectId, default: null },
    assignedTechnicianUserId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, required: true, enum: IT_TICKET_STATUSES, default: 'open' },
    sla: { type: slaSchema, required: true },
    resolution: { type: resolutionSchema, default: null },
    closedAt: { type: Date, default: null },
    reopenCount: { type: Number, required: true, default: 0 },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The code is permanent and never reused (FR-1) — unique across deleted rows too.
ticketSchema.index({ ticketCode: 1 }, { unique: true, name: 'ux_ticket_code' });
ticketSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });
ticketSchema.index({ requesterUserId: 1, createdAt: -1 }, { name: 'ix_requester_created' });
ticketSchema.index({ assignedTechnicianUserId: 1, status: 1 }, { name: 'ix_technician_status' });
ticketSchema.index({ assetId: 1, createdAt: -1 }, { name: 'ix_asset_created', sparse: true });

// THE SWEEP INDEXES (§4.5). The breach sweep runs every five minutes and asks exactly two
// questions: "which live tickets are past their response due date and not yet stamped", and the
// same for resolution. Partial on the stamp being absent, so the index only ever holds the rows
// the sweep can still act on — it shrinks as tickets are stamped rather than growing forever.
ticketSchema.index(
  { 'sla.responseDueAt': 1 },
  {
    name: 'ix_sla_response_due_unstamped',
    partialFilterExpression: { 'sla.responseBreachedAt': null, isDeleted: false },
  },
);
ticketSchema.index(
  { 'sla.resolutionDueAt': 1 },
  {
    name: 'ix_sla_resolution_due_unstamped',
    partialFilterExpression: { 'sla.resolutionBreachedAt': null, isDeleted: false },
  },
);
// The auto-close sweep's question: "which tickets have been `resolved` since before the cutoff".
ticketSchema.index({ status: 1, 'resolution.resolvedAt': 1 }, { name: 'ix_status_resolvedAt' });

export const ItTicketModel = model<ItTicketDoc>('ItTicket', ticketSchema, 'it_tickets');
