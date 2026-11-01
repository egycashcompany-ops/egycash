// A passkey (ADR-035): the public half of a key pair made on a person's device, which signs a
// one-time challenge after the device verifies them — fingerprint, face, or the device PIN.
//
// A security collection like `sessions`: strict, no baseFields, no version key. What it holds is
// public by nature (a public key, a credential id the device hands to anyone who asks), so nothing
// here is sealed; what makes it a credential is that only the device can sign for it.
import { Schema, model, type Types } from 'mongoose';

export interface PasskeyDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** WebAuthn credential id, base64url. Unique across all accounts. */
  credentialId: string;
  /** COSE public key, base64url. */
  publicKey: string;
  /** Signature counter; synced passkeys keep it at 0. */
  counter: number;
  transports: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** The session that added it — the step-up proved this session's person. */
  createdSessionId: Types.ObjectId | null;
}

const passkeySchema = new Schema<PasskeyDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    credentialId: { type: String, required: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, required: true, default: 0 },
    transports: { type: [String], default: [] },
    deviceType: { type: String, enum: ['singleDevice', 'multiDevice'], required: true },
    backedUp: { type: Boolean, required: true, default: false },
    name: { type: String, required: true },
    createdAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
    createdSessionId: { type: Schema.Types.ObjectId, default: null },
  },
  { strict: true, versionKey: false },
);
passkeySchema.index({ credentialId: 1 }, { unique: true, name: 'ux_credentialId' });
passkeySchema.index({ userId: 1 }, { name: 'ix_userId' });

export const PasskeyModel = model<PasskeyDoc>('Passkey', passkeySchema, 'passkey_credentials');

/**
 * The unique credential index, built before the first write that relies on it.
 *
 * `autoIndex` is off in production and the deploy's index sync only reports, so without this the
 * index that refuses a credential id registered twice — to the same account or, worse, to another —
 * might never exist. Once per process; a failure is forgotten so the next write tries again. (The
 * same rule as the IT register's `collectionReady`, which platform code may not import.)
 */
let indexesReady: Promise<void> | null = null;
export const passkeyIndexesReady = async (): Promise<void> => {
  indexesReady ??= PasskeyModel.createIndexes().then(
    () => undefined,
    (error: unknown) => {
      indexesReady = null;
      throw error;
    },
  );
  await indexesReady;
};
