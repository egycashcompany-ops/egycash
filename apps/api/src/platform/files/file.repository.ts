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

  async setScanStatus(id: Types.ObjectId, scanStatus: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { scanStatus } }).exec();
  }
}

export const fileRepository = new FileRepository();
