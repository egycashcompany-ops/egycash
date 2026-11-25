import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from '../shared/collection-ready';
import { ComplianceDocumentModel, type ComplianceDocumentDoc } from './document.model';

class ComplianceDocumentRepository extends BaseRepository<ComplianceDocumentDoc> {
  readonly ensureCollection = collectionReady(ComplianceDocumentModel);

  constructor() {
    super(ComplianceDocumentModel, {});
  }

  /** The live files of one folder — a filter for `list`. */
  ofFolder(folderId: string): FilterQuery<ComplianceDocumentDoc> {
    return { folderId: new Types.ObjectId(folderId) };
  }

  /**
   * How many live files each of `folderIds` holds, and when the newest was added, in one read; a
   * folder with none is absent.
   */
  async statsByFolder(
    folderIds: readonly string[],
  ): Promise<Map<string, { count: number; lastUploadedAt: Date }>> {
    if (folderIds.length === 0) return new Map();
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; n: number; last: Date }>([
        {
          $match: {
            folderId: { $in: folderIds.map((id) => new Types.ObjectId(id)) },
            isDeleted: false,
          },
        },
        { $group: { _id: '$folderId', n: { $sum: 1 }, last: { $max: '$uploadedAt' } } },
      ])
      .exec();
    return new Map(
      rows.map((row) => [String(row._id), { count: row.n, lastUploadedAt: row.last }]),
    );
  }

  /** Every live file of one folder, whole — what deleting the folder takes with it. */
  async liveOfFolder(folderId: string): Promise<ComplianceDocumentDoc[]> {
    return this.model
      .find({ folderId: new Types.ObjectId(folderId), isDeleted: false })
      .lean<ComplianceDocumentDoc[]>()
      .exec();
  }
}

export const complianceDocumentRepository = new ComplianceDocumentRepository();
