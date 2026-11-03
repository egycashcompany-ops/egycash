// Data access for files + version groups (ADR-003).
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type EntityRef } from '@ecms/contracts';
import { BaseRepository } from '../../shared/base/base.repository';
import { NotFoundError } from '../../shared/errors';
import { FileModel, type FileDoc } from './file.model';
import { FileGroupModel, type FileGroupDoc } from './file-group.model';

class FileRepository extends BaseRepository<FileDoc> {
  constructor() {
    // Files carry no branch dimension in 3.1: `own` scope = uploader; branch
    // behaves as organization (entity-derived authorization arrives with the
    // first module consumer). Documented in docs/02-architecture/files-service.md.
    super(FileModel, {});
  }

  async createGroup(entityRef: EntityRef, session?: ClientSession): Promise<FileGroupDoc> {
    const [group] = await FileGroupModel.create([{ entityRef, latestVersion: 1 }], {
      session: session ?? null,
    });
    if (group === undefined) throw new NotFoundError('group create failed');
    return group.toObject();
  }

  /** Atomically reserves the next content version for a group. */
  async allocateVersion(groupId: Types.ObjectId): Promise<number> {
    const group = await FileGroupModel.findOneAndUpdate(
      { _id: groupId },
      { $inc: { latestVersion: 1 } },
      { new: true },
    )
      .lean<FileGroupDoc>()
      .exec();
    if (group === null) throw new NotFoundError('file group not found');
    return group.latestVersion;
  }

  async markGroupNotLatest(groupId: Types.ObjectId, session?: ClientSession): Promise<void> {
    await this.model
      .updateMany({ groupId, isLatest: true }, { $set: { isLatest: false } })
      .session(session ?? null)
      .exec();
  }

  async listVersions(groupId: Types.ObjectId): Promise<FileDoc[]> {
    return this.model
      .find({ groupId, isDeleted: false } as FilterQuery<FileDoc>)
      .sort({ fileVersion: -1 })
      .lean<FileDoc[]>()
      .exec();
  }

  /** Purge path: sees soft-deleted documents too. */
  async findAnyById(id: string): Promise<FileDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model.findById(id).lean<FileDoc>().exec();
  }

  async hardDelete(id: Types.ObjectId): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
    // Remove the group when its last version is gone.
  }

  async countInGroup(groupId: Types.ObjectId): Promise<number> {
    return this.model.countDocuments({ groupId }).exec();
  }

  async deleteGroup(groupId: Types.ObjectId): Promise<void> {
    await FileGroupModel.deleteOne({ _id: groupId }).exec();
  }

  /**
   * Re-points every version of `fileId`'s group — and the group — at `entityId`, inside `session`.
   * Only within the same module and entity type (both are part of the filter). Soft-deleted
   * versions move too: they are the same file's history. `0` when no such file exists.
   */
  async reassignGroupEntity(
    fileId: string,
    ref: Pick<EntityRef, 'moduleId' | 'entityType'>,
    entityId: string,
    session: ClientSession,
  ): Promise<number> {
    if (!Types.ObjectId.isValid(fileId)) return 0;
    const owned = {
      'entityRef.moduleId': ref.moduleId,
      'entityRef.entityType': ref.entityType,
    };
    const doc = await this.model
      .findOne({ _id: new Types.ObjectId(fileId), ...owned } as FilterQuery<FileDoc>)
      .select({ groupId: 1 })
      .session(session)
      .lean<{ groupId: Types.ObjectId }>()
      .exec();
    if (doc === null) return 0;
    await FileGroupModel.updateOne(
      { _id: doc.groupId, ...owned },
      { $set: { 'entityRef.entityId': entityId } },
    )
      .session(session)
      .exec();
    const moved = await this.model
      .updateMany({ groupId: doc.groupId, ...owned } as FilterQuery<FileDoc>, {
        $set: { 'entityRef.entityId': entityId },
      })
      .session(session)
      .exec();
    return moved.matchedCount;
  }

  async setScanStatus(id: Types.ObjectId, scanStatus: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { scanStatus } }).exec();
  }

  /** Live files nobody has ever scanned — the state every upload had before a scanner existed. */
  async countUnscanned(): Promise<number> {
    return this.model.countDocuments({ scanStatus: 'unscanned', isDeleted: false }).exec();
  }

  /** Ids of up to `limit` live `unscanned` files, oldest first, after `afterId` for paging. */
  async listUnscannedIds(limit: number, afterId: Types.ObjectId | null): Promise<Types.ObjectId[]> {
    const rows = await this.model
      .find({
        scanStatus: 'unscanned',
        isDeleted: false,
        ...(afterId === null ? {} : { _id: { $gt: afterId } }),
      })
      .sort({ _id: 1 })
      .limit(limit)
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return rows.map((row) => row._id);
  }

  /** `unscanned` → `pending` for exactly these ids; a row already past `unscanned` is left alone. */
  async markUnscannedPending(ids: readonly Types.ObjectId[]): Promise<number> {
    const result = await this.model
      .updateMany(
        { _id: { $in: [...ids] }, scanStatus: 'unscanned' },
        { $set: { scanStatus: 'pending' } },
      )
      .exec();
    return result.modifiedCount;
  }

  /**
   * Which of these entities still hold at least one LIVE file — one query for the whole set.
   *
   * It answers a question about PRESENCE, not about contents: the only thing that comes back is a
   * subset of the entity ids the caller already named, so there is nothing here for a caller to
   * learn that it did not already know. That is why it needs no scope and no ADR-023 pass, and it
   * is deliberately the only shape this method has — widen it to return files and it would need
   * both.
   *
   * «Live» is the same three clauses the listing uses — not soft-deleted, the latest version, and
   * `active` rather than archived — so a caller cannot see a file here that the listing would hide.
   */
  async entityIdsWithLiveFiles(
    moduleId: string,
    entityTypes: readonly string[],
    entityIds: readonly string[],
  ): Promise<Set<string>> {
    if (entityIds.length === 0) return new Set<string>();
    const found = await this.model.distinct('entityRef.entityId', {
      isDeleted: false,
      isLatest: true,
      status: 'active',
      'entityRef.moduleId': moduleId,
      'entityRef.entityType': { $in: [...entityTypes] },
      'entityRef.entityId': { $in: [...entityIds] },
    } as FilterQuery<FileDoc>);
    return new Set(found.map((value) => String(value)));
  }

  /** Live files whose scan has been `pending` since before `uploadedBefore`, oldest first. */
  async listPendingScans(uploadedBefore: Date, limit: number): Promise<FileDoc[]> {
    return this.model
      .find({ scanStatus: 'pending', isDeleted: false, uploadedAt: { $lte: uploadedBefore } })
      .sort({ uploadedAt: 1 })
      .limit(limit)
      .lean<FileDoc[]>()
      .exec();
  }
}

export const fileRepository = new FileRepository();
