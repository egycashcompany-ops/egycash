// Data access only (ADR-003) — the sole place Mongoose is queried for users.
import { Types, type ClientSession, type FilterQuery, type UpdateQuery } from 'mongoose';
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

  /**
   * Every live account whose English "first last" reads as `fullName` (compared case-insensitively
   * and trimmed). Returns ALL matches rather than the first, because the only safe answer to a name
   * shared by two people is "this name is not an identifier" — the caller decides, and cannot if
   * the second match is hidden. Names are not unique in this system; email and username are.
   */
  async findByFullNameEn(fullName: string): Promise<UserDoc[]> {
    return this.model
      .find({
        isDeleted: false,
        $expr: {
          $eq: [
            {
              $toLower: {
                $trim: {
                  input: { $concat: ['$profile.firstName.en', ' ', '$profile.lastName.en'] },
                },
              },
            },
            fullName.trim().toLowerCase(),
          ],
        },
      })
      .lean<UserDoc[]>()
      .exec();
  }

  /**
   * Point this login at an employee — but only while it points at nobody.
   *
   * The filter carries the precondition, so two administrators linking the same login at the same
   * moment cannot both succeed: the second matches nothing and is told so, instead of overwriting
   * the first and leaving one employee's `userId` dangling. Same shape as `clearActivationByHash`,
   * for the same reason.
   */
  async linkEmployee(
    userId: string,
    employeeId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: userId, isDeleted: false, employeeId: null },
        { $set: { employeeId: new Types.ObjectId(employeeId) } },
        session === undefined ? {} : { session },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** The mirror: unlink only while the link is the one the caller believes it is. */
  async unlinkEmployee(
    userId: string,
    employeeId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: userId, isDeleted: false, employeeId: new Types.ObjectId(employeeId) },
        { $set: { employeeId: null } },
        session === undefined ? {} : { session },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async findByActivationTokenHash(tokenHash: string): Promise<UserDoc | null> {
    return this.model
      .findOne({ 'activation.tokenHash': tokenHash, isDeleted: false })
      .lean<UserDoc>()
      .exec();
  }

  /** §15.7 sweep input: live accounts still holding an expired pending link. */
  async findExpiredActivations(now: Date): Promise<UserDoc[]> {
    return this.model
      .find({
        'activation.tokenHash': { $ne: null },
        'activation.expiresAt': { $lt: now },
        isDeleted: false,
      })
      .lean<UserDoc[]>()
      .exec();
  }

  /** Clears a pending link only if the SAME token is still current (sweep-vs-resend race). */
  async clearActivationByHash(userId: string, tokenHash: string): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: userId, 'activation.tokenHash': tokenHash, isDeleted: false } as FilterQuery<UserDoc>,
        { $set: { 'activation.tokenHash': null, 'activation.expiresAt': null } },
      )
      .exec();
    return result.modifiedCount === 1;
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
