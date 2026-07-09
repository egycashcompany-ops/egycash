// One session document = one device's rotation family (ADR-006). Refresh tokens are
// stored HASHED; used hashes are kept (bounded) so replay of a rotated token proves theft.
import { Schema, model, type Types } from 'mongoose';

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  family: string;
  currentTokenHash: string;
  usedTokenHashes: string[];
  device: { userAgent: string | null; ip: string | null };
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    family: { type: String, required: true },
    currentTokenHash: { type: String, required: true },
    usedTokenHashes: { type: [String], default: [] },
    device: {
      userAgent: { type: String, default: null },
      ip: { type: String, default: null },
    },
    createdAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { strict: true, versionKey: false },
);
sessionSchema.index({ currentTokenHash: 1 }, { unique: true, name: 'ux_currentTokenHash' });
sessionSchema.index({ usedTokenHashes: 1 }, { name: 'ix_usedTokenHashes' });
sessionSchema.index({ userId: 1 }, { name: 'ix_userId' });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });

export const SessionModel = model<SessionDoc>('Session', sessionSchema, 'sessions');
