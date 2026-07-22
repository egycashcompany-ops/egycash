// Data access only (ADR-003) — the sole place Mongoose is queried for users.
import { type FilterQuery, type UpdateQuery } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { UserModel, type UserDoc } from './user.model';

class UserRepository extends BaseRepository<UserDoc> {
  constructor() {
    // Scoped by the full org hierarchy (ADR-017): section ⊂ department ⊂ branch ⊂ organization.
    super(UserModel, {
      branchField: 'organization.branchId',
      departmentField: 'organization.departmentId',
      sectionField: 'organization.sectionId',
    });
  }

  async findByEmail(email: string): Promise<UserDoc | null> {
    return this.model
      .findOne({ email: email.toLowerCase(), isDeleted: false })
      .lean<UserDoc>()
      .exec();
  }

  async findByUsername(username: string): Promise<UserDoc | null> {
    return this.model
      .findOne({ username: username.toLowerCase(), isDeleted: false })
      .lean<UserDoc>()
      .exec();
  }

  async findByActivationTokenHash(tokenHash: string): Promise<UserDoc | null> {
    return this.model
      .findOne({ 'activation.tokenHash': tokenHash, isDeleted: false })
      .lean<UserDoc>()
      .exec();
  }

  /** Security-state updates bypass optimistic concurrency (single-field counters). */
  async updateSecurity(userId: string, update: UpdateQuery<UserDoc>): Promise<UserDoc | null> {
    return this.model
      .findOneAndUpdate({ _id: userId, isDeleted: false } as FilterQuery<UserDoc>, update, {
        new: true,
      })
      .lean<UserDoc>()
      .exec();
  }

  /** Atomically removes a backup-code hash; true only when it was present. */
  async consumeBackupCode(userId: string, codeHash: string): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: userId, 'security.totp.backupCodeHashes': codeHash } as FilterQuery<UserDoc>,
        { $pull: { 'security.totp.backupCodeHashes': codeHash } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  searchFilter(search: string): FilterQuery<UserDoc> {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return {
      $or: [
        { email: pattern },
        { 'profile.firstName.ar': pattern },
        { 'profile.firstName.en': pattern },
        { 'profile.lastName.ar': pattern },
        { 'profile.lastName.en': pattern },
      ],
    };
  }
}

export const userRepository = new UserRepository();
