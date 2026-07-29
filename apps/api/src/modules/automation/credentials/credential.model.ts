// Automation credentials (ADR-018 §7.3) — secrets a workflow presents to a third party.
//
// The plaintext is never in this document. What is stored is a `SealedValue` from the platform
// crypto service (A-1): envelope-encrypted, bound by AAD to `automation_credentials:<id>:value`,
// so a ciphertext copied into another row FAILS to decrypt rather than authenticating as the
// wrong secret.
//
// `sealed.keyId` is in the clear on purpose. Rotation is "find everything not on the active key
// and re-wrap it", and that query has to be possible without decrypting anything.
import { Schema, model, type Types } from 'mongoose';
import {
  type AutomationCredentialType,
  type DataScope,
  type LocalizedString,
  type SealedValue,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AutomationCredentialDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  type: AutomationCredentialType;
  sealed: SealedValue;
  ownerUserId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  branchScope: DataScope;
  lastUsedAt: Date | null;
  /** Bumped on every value replacement — an execution can record which one it used. */
  valueVersion: number;
}

const sealedField = {
  _id: false,
  v: { type: Number, required: true, default: 1 },
  keyId: { type: String, required: true },
  wrappedKey: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
  ciphertext: { type: String, required: true },
  aad: { type: String, required: true },
} as const;

const automationCredentialSchema = new Schema<AutomationCredentialDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    type: { type: String, required: true },
    sealed: { type: sealedField, required: true },
    ownerUserId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    branchScope: {
      type: String,
      enum: ['own', 'section', 'department', 'branch', 'organization'],
      required: true,
      default: 'branch',
    },
    lastUsedAt: { type: Date, default: null },
    valueVersion: { type: Number, required: true, default: 1 },
    ...baseFields,
  },
  baseSchemaOptions,
);

automationCredentialSchema.index(
  { key: 1 },
  { name: 'ux_key', unique: true, partialFilterExpression: { isDeleted: false } },
);
// The rotation sweep: "everything not on the active key". Without an index it is a collection
// scan on the one job that must be cheap enough to run unattended.
automationCredentialSchema.index({ 'sealed.keyId': 1 }, { name: 'ix_keyId' });

export const AutomationCredentialModel = model<AutomationCredentialDoc>(
  'AutomationCredential',
  automationCredentialSchema,
  'automation_credentials',
);
