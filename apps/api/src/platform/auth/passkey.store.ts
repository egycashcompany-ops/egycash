// Reads and writes of passkeys (ADR-035). No WebAuthn here — `passkey.service.ts` runs the
// ceremonies; this is where a passkey is kept, found, renamed and removed, so the account
// lifecycle (reset, suspend, archive, delete) can remove them without pulling in the ceremonies.
import { Types } from 'mongoose';
import { type PasskeyDto } from '@ecms/contracts';
import { auditService } from '../audit';
import { PasskeyModel, passkeyIndexesReady, type PasskeyDoc } from './passkey.model';

const userRef = (userId: string) => ({
  moduleId: 'platform',
  entityType: 'user',
  entityId: userId,
});

export const toPasskeyDto = (doc: PasskeyDoc): PasskeyDto => ({
  id: String(doc._id),
  name: doc.name,
  createdAt: doc.createdAt.toISOString(),
  lastUsedAt: doc.lastUsedAt === null ? null : doc.lastUsedAt.toISOString(),
  backedUp: doc.backedUp,
});

export const passkeyStore = {
  async findByCredentialId(credentialId: string): Promise<PasskeyDoc | null> {
    return PasskeyModel.findOne({ credentialId }).lean<PasskeyDoc>().exec();
  },

  async listForUser(userId: string): Promise<PasskeyDoc[]> {
    return PasskeyModel.find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 })
      .lean<PasskeyDoc[]>()
      .exec();
  },

  async countForUser(userId: string): Promise<number> {
    return PasskeyModel.countDocuments({ userId: new Types.ObjectId(userId) }).exec();
  },

  async create(doc: Omit<PasskeyDoc, '_id'>): Promise<PasskeyDoc> {
    await passkeyIndexesReady();
    const [created] = await PasskeyModel.create([doc]);
    if (created === undefined) throw new Error('passkey create failed');
    return created.toObject<PasskeyDoc>();
  },

  /** After a verified sign-in: the counter the device reported, and when. */
  async recordUse(id: Types.ObjectId, counter: number, backedUp: boolean): Promise<void> {
    await PasskeyModel.updateOne(
      { _id: id },
      { $set: { counter, backedUp, lastUsedAt: new Date() } },
    ).exec();
  },

  /** The caller's own passkey, or null — never another account's. */
  async findOwn(userId: string, id: string): Promise<PasskeyDoc | null> {
    return PasskeyModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    })
      .lean<PasskeyDoc>()
      .exec();
  },

  async rename(id: Types.ObjectId, name: string): Promise<PasskeyDoc | null> {
    return PasskeyModel.findOneAndUpdate({ _id: id }, { $set: { name } }, { new: true })
      .lean<PasskeyDoc>()
      .exec();
  },

  async removeOne(id: Types.ObjectId): Promise<void> {
    await PasskeyModel.deleteOne({ _id: id }).exec();
  },

  /**
   * Every passkey on the account, gone — an administrator's password reset, or the account being
   * suspended, archived or deleted (ADR-035 §8). Audited once, with how many and why, when there
   * were any.
   */
  async removeAllForUser(userId: string, reason: string): Promise<number> {
    const { deletedCount } = await PasskeyModel.deleteMany({
      userId: new Types.ObjectId(userId),
    }).exec();
    if (deletedCount > 0) {
      await auditService.record({
        entityRef: userRef(userId),
        action: 'passkeyRemoved',
        changes: [
          { field: 'reason', old: null, new: reason },
          { field: 'count', old: deletedCount, new: 0 },
        ],
      });
    }
    return deletedCount;
  },
};
