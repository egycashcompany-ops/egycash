// A maintenance mail ticket — legacy collection `atm_mails` (models/atm_mailss.js), written by
// the per-branch mail reader (Automation/src/index.js:178-192) and decided on /mail_maintenance.
//
// `actionAt` is NEW: the legacy log showed WHO decided but never WHEN (port doc GAP G1).
// `providerMessageId` is NEW: the ingest idempotency key — the legacy reader relied on marking
// the mailbox message read, which loses exactly when the DB write succeeded and the mark failed.
// `duplication`/`foundInMaster` keep the ingest-time values for parity; the pending list serves
// duplication RECOMPUTED, as the legacy GET did on every render (contad_app.js:2674-2698).
import { Schema, model, type Types } from 'mongoose';
import { ATM_MAIL_TICKET_STATUSES, type AtmMailTicketStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AtmMailTicketDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  machineId: Types.ObjectId | null;
  machineCode: string;
  bankName: string;
  machineName: string;
  area: string;
  /** Legacy `open_time` — when the reader stored the mail. */
  receivedAt: Date;
  status: AtmMailTicketStatus;
  /** Legacy `status_txt` — the issue text extracted from the email body. */
  issueText: string;
  senderEmail: string;
  foundInMaster: boolean;
  duplicationAtIngest: boolean;
  actionById: Types.ObjectId | null;
  actionByName: string | null;
  actionAt: Date | null;
  providerMessageId: string | null;
}

const mailTicketSchema = new Schema<AtmMailTicketDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    machineId: { type: Schema.Types.ObjectId, default: null },
    machineCode: { type: String, required: true },
    bankName: { type: String, required: true },
    machineName: { type: String, required: true },
    area: { type: String, required: true },
    receivedAt: { type: Date, required: true },
    status: { type: String, required: true, enum: ATM_MAIL_TICKET_STATUSES, default: 'pending' },
    issueText: { type: String, required: true },
    senderEmail: { type: String, required: true },
    foundInMaster: { type: Boolean, required: true, default: true },
    duplicationAtIngest: { type: Boolean, required: true, default: false },
    actionById: { type: Schema.Types.ObjectId, default: null },
    actionByName: { type: String, default: null },
    actionAt: { type: Date, default: null },
    providerMessageId: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

mailTicketSchema.index({ branchId: 1, status: 1, receivedAt: -1 }, { name: 'ix_branch_status' });
mailTicketSchema.index({ branchId: 1, receivedAt: -1 }, { name: 'ix_branch_received' });
mailTicketSchema.index(
  { providerMessageId: 1 },
  {
    unique: true,
    name: 'ux_provider_message',
    partialFilterExpression: { providerMessageId: { $type: 'string' } },
  },
);

export const AtmMailTicketModel = model<AtmMailTicketDoc>(
  'AtmMailTicket',
  mailTicketSchema,
  'atm_mail_tickets',
);
