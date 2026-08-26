// Data access only (ADR-003) — the sole place Mongoose is queried for users.
import { Types, type ClientSession, type FilterQuery, type UpdateQuery } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { type ScopeSelector } from '../../shared/types';
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

  /**
   * The scope clause for a user document reached through a JOIN, e.g. `holder.organization.branchId`
   * on an aggregation over another collection.
   *
   * It mirrors the fields declared in the constructor three lines above — deliberately kept in the
   * same file so the two cannot drift apart unnoticed — and returns the SAME shape `scopeFilter`
   * would, so a joined read narrows exactly as a direct one does. It exists because
   * `role_assignments` carries no placement of its own: who may see an assignment is decided by the
   * holder's placement, and the only correct way to filter on that is to join.
   */
  holderScopeMatch(
    selector: ScopeSelector | undefined,
    prefix: string,
  ): Record<string, unknown> {
    if (selector === undefined || selector.scope === 'organization') return {};
    const on = (field: string, id: string | null): Record<string, unknown> =>
      // A caller with no placement at the level they are scoped to sees nothing — the same
      // fail-closed answer `orgScopeFilter` gives, rather than an accidental widening.
      id === null
        ? { _id: new Types.ObjectId('000000000000000000000000') }
        : { [`${prefix}${field}`]: new Types.ObjectId(id) };
    if (selector.scope === 'branch') return on('organization.branchId', selector.branchId);
    if (selector.scope === 'department') {
      return on('organization.departmentId', selector.departmentId);
    }
    if (selector.scope === 'section') return on('organization.sectionId', selector.sectionId);
    // `own` on users has no owner field, so it means "accounts I created" — the same reading
    // `scopeFilter` gives it here.
    return { [`${prefix}createdBy`]: new Types.ObjectId(selector.userId) };
  }

  /**
   * Which of these accounts could actually sign in right now — ACTIVE and not deleted.
   *
   * Used by the last-Super-Admin guard, where "who holds the role" is the wrong question: an
   * archived account keeps its assignments (archiving is not a revocation) but can never sign in
   * again, so counting it would let the last usable administrator be retired.
   */
  async activeIdsAmong(userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const docs = await this.model
      .find({
        _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
        status: 'active',
        isDeleted: false,
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return docs.map((doc) => String(doc._id));
  }

  /**
   * The reading language of each of these accounts.
   *
   * For a bilingual message whose two halves are written by a HUMAN — an announcement — rather
   * than authored into a template. A template renders one `data` map into both languages, so the
   * only way to give an Arabic reader the Arabic text and an English reader the English one is to
   * send each group its own, and that needs to know who is in which group.
   */
  async localesAmong(userIds: readonly string[]): Promise<Map<string, 'ar' | 'en'>> {
    if (userIds.length === 0) return new Map();
    const docs = await this.model
      .find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) }, isDeleted: false })
      .select('_id locale')
      .lean<{ _id: Types.ObjectId; locale: 'ar' | 'en' }[]>()
      .exec();
    return new Map(docs.map((doc) => [String(doc._id), doc.locale]));
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

  /**
   * Bind or re-point the external subject. Written by the owning module's service only, exactly
   * like `linkEmployee`; the precondition it carries is that the account is not an employee's.
   */
  async setExternalSubject(
    userId: string,
    subject: { moduleId: string; subjectType: string; subjectId: Types.ObjectId },
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: userId, isDeleted: false, employeeId: null },
        { $set: { externalSubject: subject } },
      )
      .exec();
    return result.matchedCount === 1;
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
  /**
   * The one account belonging to an external subject, or null.
   *
   * The owning module holds the relationship (ADR-027); the platform only stores and finds it. A
   * module asking "does this person already have a login?" asks here rather than keeping a second
   * index of its own.
   */
  async findByExternalSubject(
    moduleId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<UserDoc | null> {
    if (!Types.ObjectId.isValid(subjectId)) return null;
    return this.model
      .findOne({
        'externalSubject.moduleId': moduleId,
        'externalSubject.subjectType': subjectType,
        'externalSubject.subjectId': new Types.ObjectId(subjectId),
        isDeleted: false,
      } as FilterQuery<UserDoc>)
      .lean<UserDoc>()
      .exec();
  }

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
