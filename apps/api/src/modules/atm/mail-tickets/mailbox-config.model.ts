// The Banque Misr maintenance mailbox the central reader polls — ONE document (`key: 'default'`),
// edited on /atm/settings («بريد الصيانة — بنك مصر»).
//
// The owner (2026-10-28): one shared mailbox for every branch, the branches switched on one at a
// time, and the mailbox credentials typed on a screen with the secret stored encrypted — never in
// code. While no document exists the reader keeps the deployment's `ATM_MAIL_GRAPH_*` environment
// exactly as before; once one exists it is the only source, and a disabled one reads nothing
// (mailbox-source.ts).
//
// `clientSecretRef` is the platform secret store's SEALED ref, bound to this document's id
// (`atm_mailbox_config:<id>:clientSecret`), so a ref copied onto another record fails to open. It
// is never returned, logged or audited — the DTO says only `hasSecret`.
//
// `lastPoll` is the reader's own status line. It is written after every run WITHOUT `__v` or
// `updatedAt` moving: a poll a minute must never turn the screen's next save into a stale 409.
import { Schema, model, type Types } from 'mongoose';
import { type SecretRef } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/** The one document's key — a second document is a bug, and the unique index says so. */
export const ATM_MAILBOX_KEY = 'default';

export interface AtmMailboxBranchRow {
  branchId: Types.ObjectId;
  /** The Outlook category its mail is tagged with; null = `atm.mail.branchCategories` answers. */
  category: string | null;
}

/** One reader run, as `lastPoll` keeps it (`AtmMailPollRunDto` with a Date). */
export interface AtmMailPollRunRecord {
  at: Date;
  read: number;
  created: number;
  duplicates: number;
  unmatched: number;
  failed: number;
  error: string | null;
  unmatchedReasons: string[];
}

export interface AtmMailboxConfigDoc extends BaseDocFields {
  key: string;
  tenantId: string;
  clientId: string;
  clientSecretRef: SecretRef | null;
  /** The mailbox read — Graph's `/users/{userEmail}/messages`. */
  userEmail: string;
  enabled: boolean;
  branches: AtmMailboxBranchRow[];
  lastPoll: AtmMailPollRunRecord | null;
}

// The secret store's ref, the register's shape (register/register.model.ts): `provider` and `keyId`
// in the clear for the rotation sweep, `ref` opaque to everyone but the store.
const secretRefSchema = new Schema(
  {
    provider: { type: String, required: true },
    keyId: { type: String, default: null },
    ref: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const branchRowSchema = new Schema<AtmMailboxBranchRow>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    category: { type: String, default: null },
  },
  { _id: false },
);

const pollRunSchema = new Schema<AtmMailPollRunRecord>(
  {
    at: { type: Date, required: true },
    read: { type: Number, required: true },
    created: { type: Number, required: true },
    duplicates: { type: Number, required: true },
    unmatched: { type: Number, required: true },
    failed: { type: Number, required: true },
    error: { type: String, default: null },
    unmatchedReasons: { type: [String], default: [] },
  },
  { _id: false },
);

const mailboxConfigSchema = new Schema<AtmMailboxConfigDoc>(
  {
    key: { type: String, required: true, default: ATM_MAILBOX_KEY },
    tenantId: { type: String, required: true },
    clientId: { type: String, required: true },
    clientSecretRef: { type: secretRefSchema, default: null },
    userEmail: { type: String, required: true },
    enabled: { type: Boolean, required: true, default: false },
    branches: { type: [branchRowSchema], default: [] },
    lastPoll: { type: pollRunSchema, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

mailboxConfigSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_mailbox_key', partialFilterExpression: { isDeleted: false } },
);

export const AtmMailboxConfigModel = model<AtmMailboxConfigDoc>(
  'AtmMailboxConfig',
  mailboxConfigSchema,
  'atm_mailbox_config',
);
