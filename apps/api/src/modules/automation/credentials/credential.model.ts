// Automation credentials (ADR-018 §7.3) — secrets a workflow presents to a third party.
//
// The plaintext is never in this document. What is stored is a `SecretRef` from the platform
// secret store (A-4.1): opaque here, bound by the store to `automation_credentials:<id>:value`,
// so a ref copied into another row FAILS to open rather than authenticating as the wrong secret.
//
// This model does NOT know the ref is a sealed AES envelope — that is the platform-crypto store's
// business, and the whole point of the seam is that a KMS/vault store could replace it without a
// migration here. `secretRef.keyId` is in the clear on purpose: rotation is "find everything not
// on the current key and re-wrap it", and that query has to be possible without opening anything.
import { Schema, model, type Types } from 'mongoose';
import {
  type AutomationCredentialType,
  type DataScope,
  type LocalizedString,
  type SecretRef,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AutomationCredentialDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  type: AutomationCredentialType;
  secretRef: SecretRef;
  ownerUserId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  branchScope: DataScope;
  lastUsedAt: Date | null;
  /** Bumped on every value replacement — an execution can record which one it used. */
  valueVersion: number;
}

// The ref is provider-owned and opaque: `provider` and `keyId` are queryable metadata (rotation
// needs them in the clear); `ref` is `Mixed` because ONLY the store that produced it may interpret
// it. Modelling its innards here would re-couple the collection to one backend.
const secretRefField = {
  _id: false,
  provider: { type: String, required: true },
  keyId: { type: String, default: null },
  ref: { type: Schema.Types.Mixed, required: true },
} as const;

const automationCredentialSchema = new Schema<AutomationCredentialDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    type: { type: String, required: true },
    secretRef: { type: secretRefField, required: true },
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
// The rotation sweep: "everything not on the current key". Without an index it is a collection
// scan on the one job that must be cheap enough to run unattended.
automationCredentialSchema.index({ 'secretRef.keyId': 1 }, { name: 'ix_keyId' });

export const AutomationCredentialModel = model<AutomationCredentialDoc>(
  'AutomationCredential',
  automationCredentialSchema,
  'automation_credentials',
);
